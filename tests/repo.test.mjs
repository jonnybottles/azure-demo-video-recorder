import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';
import { normalizeExampleDomain } from '../skills/azure-demo-video-recorder/assets/engine/qa.mjs';
import { narrationClip } from '../skills/azure-demo-video-recorder/assets/engine/voice.mjs';
import { paceToScript } from '../skills/azure-demo-video-recorder/assets/engine/helpers.mjs';
import { speakable } from '../skills/azure-demo-video-recorder/assets/engine/builder.mjs';
import { scanLockfile, scanRepository, scanText } from '../scripts/check-public-content.mjs';

const root = path.resolve('.');

test('OCR normalizes truncated and noisy reserved example.com addresses', () => {
  const address = (domain) => `person@${domain}`;
  assert.equal(normalizeExampleDomain(address('example.co')), 'person@example.com');
  assert.equal(normalizeExampleDomain(address('exampIe.c0l')), 'person@example.com');
  assert.equal(normalizeExampleDomain('person@example.com'), 'person@example.com');
});

test('paceToScript waits out the line spoken at the last mark, and skips marks with no line', async () => {
  const marks = [];
  const pace = paceToScript({ shot: { said: 0.3 } }, { margin: 0.1 });
  const mark = pace.marker({ mark: (name) => marks.push(name) }, 'shot');
  mark('said');
  const started = Date.now();
  await pace.fill();
  assert.ok(Date.now() - started >= 350, 'fill() returned before the line and margin had passed');
  mark('silent');
  const quiet = Date.now();
  await pace.fill();
  assert.ok(Date.now() - quiet < 50, 'fill() waited at a mark with no line');
  assert.deepEqual(marks, ['said', 'silent']);
});

test('pronounce rewrites whole words only, any case, exact case first', () => {
  const pronounce = { ACMECLOUD: 'Acme Cloud', acmecloud: 'acme cloud', README: 'reed me' };
  assert.equal(speakable("ACMECLOUD's portal", pronounce), "Acme Cloud's portal");
  assert.equal(speakable('run acmecloud login', pronounce), 'run acme cloud login');
  assert.equal(speakable('Open the README file, not READMEFIRST', pronounce), 'Open the reed me file, not READMEFIRST');
});

test('hosted voice providers fail clearly when credentials are absent', async () => {
  const openAiKey = process.env.OPENAI_API_KEY;
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await assert.rejects(() => narrationClip('Preview line.', { provider: 'openai' }), /Set OPENAI_API_KEY/);
    await assert.rejects(() => narrationClip('Preview line.', { provider: 'elevenlabs', name: 'Voice' }), /Set ELEVENLABS_API_KEY/);
  } finally {
    if (openAiKey !== undefined) process.env.OPENAI_API_KEY = openAiKey;
    if (elevenLabsKey !== undefined) process.env.ELEVENLABS_API_KEY = elevenLabsKey;
  }
});

test('OpenAI voice sends the configured request only to the local test endpoint', async (t) => {
  let requestBody = '';
  let authorization = '';
  const server = http.createServer((req, res) => {
    authorization = req.headers.authorization;
    req.setEncoding('utf8');
    req.on('data', (chunk) => { requestBody += chunk; });
    req.on('end', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'local test response' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const previous = {
    key: process.env.OPENAI_API_KEY,
    endpoint: process.env.OPENAI_TTS_ENDPOINT
  };
  process.env.OPENAI_API_KEY = 'local-test-key';
  process.env.OPENAI_TTS_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/audio/speech`;
  try {
    await assert.rejects(() => narrationClip('Sample spoken line.', {
      provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'marin', instructions: 'Clear narration.'
    }), /OpenAI speech synthesis failed \(400\)/);
    assert.equal(authorization, 'Bearer local-test-key');
    assert.deepEqual(JSON.parse(requestBody), {
      model: 'gpt-4o-mini-tts', voice: 'marin', input: 'Sample spoken line.',
      instructions: 'Clear narration.', response_format: 'mp3'
    });
  } finally {
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.key;
    if (previous.endpoint === undefined) delete process.env.OPENAI_TTS_ENDPOINT;
    else process.env.OPENAI_TTS_ENDPOINT = previous.endpoint;
  }
});

test('quickstart storyboard references only recorded shots and supported cards', () => {
  const folder = path.join(root, 'examples', 'quickstart', 'video', 'quickstart');
  const board = YAML.parse(fs.readFileSync(path.join(folder, 'storyboard.yaml'), 'utf8'));
  const source = fs.readFileSync(path.join(folder, 'record.mjs'), 'utf8');
  const supported = new Set(['intro', 'section', 'timeskip', 'bullets', 'usecase', 'closing', 'end']);
  const shotIds = new Set([...source.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]));
  for (const scene of board.scenes) {
    if (scene.card) assert.ok(supported.has(scene.card.type), `unsupported card type: ${scene.card.type}`);
    for (const shot of scene.shots ?? []) assert.ok(shotIds.has(shot.id), `missing recorder shot: ${shot.id}`);
  }
});

test('public skill metadata and linked references are self-contained', () => {
  const skillFile = path.join(root, 'skills', 'azure-demo-video-recorder', 'SKILL.md');
  const source = fs.readFileSync(skillFile, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, 'skill frontmatter is required');
  const metadata = YAML.parse(match[1]);
  assert.equal(metadata.name, 'azure-demo-video-recorder');
  assert.ok(metadata.description.length <= 1024);
  for (const [, relative] of source.matchAll(/\]\((references\/[^)#]+\.md)(?:#[^)]*)?\)/g)) {
    assert.ok(fs.existsSync(path.join(path.dirname(skillFile), relative)), `missing skill reference: ${relative}`);
  }
});

test('public-content rules detect synthetic identifiers without reporting matched values', () => {
  const cases = [
    ['non-example-email', ['person', 'private.invalid'].join('@')],
    ['tenant-domain', ['sample-tenant', 'onmicrosoft', 'com'].join('.')],
    ['guid-literal', [8, 4, 4, 4, 12].map((size) => '0'.repeat(size)).join('-')],
    ['user-home-path', ['C:', 'Users', 'sample-person', 'file.txt'].join('\\')],
    ['private-key', ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')],
    ['credential-literal', `ghp_${'a'.repeat(36)}`],
    ['company-package-feed', `https://${['packages', 'pkgs', 'visualstudio', 'com'].join('.')}/registry/`],
    ['deployed-endpoint', ['demo-app', 'azurewebsites', 'net'].join('.')],
    ['ip-address', [10, 42, 7, 9].join('.')]
  ];
  for (const [rule, value] of cases) {
    const findings = scanText(`Synthetic fixture\n${value}`, 'fixture.txt');
    assert.ok(findings.some((finding) => finding.rule === rule && finding.line === 2), rule);
    assert.ok(!JSON.stringify(findings).includes(value), 'diagnostics must not expose matched values');
  }
  assert.deepEqual(scanText('person@example.com https://portal.azure.com 127.0.0.1 192.0.2.1', 'fixture.txt'), []);
});

test('lockfile policy requires public registry resolutions and valid integrity metadata', () => {
  const entry = {
    version: '1.0.0', resolved: 'https://registry.npmjs.org/sample/-/sample-1.0.0.tgz',
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`
  };
  const lock = (value) => JSON.stringify({ packages: { '': {}, 'node_modules/sample': value } });
  assert.deepEqual(scanLockfile(lock(entry), 'package-lock.json'), []);
  const privateRegistry = { ...entry, resolved: 'https://registry.example.org/sample.tgz' };
  assert.ok(scanLockfile(lock(privateRegistry), 'package-lock.json').some((finding) => finding.rule === 'non-public-package-resolution'));
  const credentialed = new URL(entry.resolved);
  credentialed.username = 'synthetic-user';
  credentialed.password = 'synthetic-password';
  assert.ok(scanLockfile(lock({ ...entry, resolved: credentialed.href }), 'package-lock.json').some((finding) => finding.rule === 'non-public-package-resolution'));
  assert.ok(scanLockfile(lock({ version: entry.version }), 'package-lock.json').some((finding) => finding.rule === 'missing-public-package-resolution'));
  assert.ok(scanLockfile(lock({ ...entry, integrity: '' }), 'package-lock.json').some((finding) => finding.rule === 'missing-package-integrity'));
  assert.equal(scanLockfile(lock({ link: true }), 'package-lock.json')[0].rule, 'local-package-link-requires-review');
  assert.equal(scanLockfile(lock(null), 'package-lock.json')[0].rule, 'invalid-lockfile-entry');
  assert.equal(scanLockfile('{', 'package-lock.json')[0].rule, 'invalid-lockfile-json');
  assert.equal(scanLockfile('{}', 'package-lock.json')[0].rule, 'missing-lockfile-packages');
});

test('public-content inventory covers hidden and extensionless files while honoring ignored local data', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'public-content-'));
  try {
    const init = spawnSync('git', ['init', '--quiet', temp], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const value = ['person', 'private.invalid'].join('@');
    fs.writeFileSync(path.join(temp, '.gitignore'), '.local/\n');
    fs.writeFileSync(path.join(temp, 'LICENSE'), value);
    fs.writeFileSync(path.join(temp, '.sample-config'), value);
    fs.writeFileSync(path.join(temp, 'package-lock.json'), JSON.stringify({ packages: { '': {} } }));
    fs.mkdirSync(path.join(temp, '.local'));
    fs.writeFileSync(path.join(temp, '.local', 'ignored.txt'), value);
    fs.mkdirSync(path.join(temp, 'docs'));
    fs.writeFileSync(path.join(temp, 'docs', 'preview.gif'), Buffer.from([0, 1, 2]));
    const report = scanRepository(temp);
    assert.ok(report.findings.some((finding) => finding.path === 'LICENSE'));
    assert.ok(report.findings.some((finding) => finding.path === '.sample-config'));
    assert.ok(report.findings.some((finding) => finding.rule === 'unreviewed-binary'));
    assert.ok(!report.findings.some((finding) => finding.path.includes('ignored.txt')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('repository content and README disclaimer meet the public-release policy', () => {
  assert.deepEqual(scanRepository(root).findings, []);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const introduction = readme.split('## What it produces')[0];
  assert.match(introduction, /personal, independent project/i);
  assert.match(introduction, /not an official Microsoft product/i);
  assert.match(introduction, /not[\s\S]*endorsed by, or supported by Microsoft/i);
});

test('scaffolder preserves existing storyboards and ignores local media', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-demo-video-'));
  try {
    const scenario = path.join(temp, 'video', 'sample');
    fs.mkdirSync(scenario, { recursive: true });
    fs.writeFileSync(path.join(scenario, 'storyboard.yaml'), 'output: Keep-Me\n');
    const script = path.join(root, 'skills', 'azure-demo-video-recorder', 'scripts', 'new-demo-video.mjs');
    const result = spawnSync(process.execPath, [script, '--target', temp, '--scenarios', 'sample', '--skip-install'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Missing prerequisites:/);
    assert.equal(fs.readFileSync(path.join(scenario, 'storyboard.yaml'), 'utf8'), 'output: Keep-Me\n');
    assert.ok(fs.existsSync(path.join(temp, 'video', 'engine', 'cli.mjs')));
    assert.ok(fs.existsSync(path.join(temp, 'video', 'engine', 'helpers.mjs')));
    assert.match(fs.readFileSync(path.join(temp, '.gitignore'), 'utf8'), /\.local\//);

    // An older project refreshed with --refresh-engine gains the new scripts but keeps its own values.
    const packageFile = path.join(temp, 'video', 'package.json');
    const older = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    delete older.scripts.lines;
    delete older.scripts.speed;
    older.scripts.build = 'node engine/cli.mjs build --custom';
    fs.writeFileSync(packageFile, JSON.stringify(older));
    const refresh = spawnSync(process.execPath, [script, '--target', temp, '--scenarios', 'sample', '--skip-install', '--refresh-engine'], { encoding: 'utf8' });
    assert.equal(refresh.status, 0, refresh.stderr);
    const refreshed = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    assert.equal(refreshed.scripts.lines, 'node engine/cli.mjs lines');
    assert.equal(refreshed.scripts.speed, 'node engine/cli.mjs speed');
    assert.equal(refreshed.scripts.build, 'node engine/cli.mjs build --custom');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('quickstart registry is loopback-only and duplicate delivery has no second write', async (t) => {
  const serverFile = path.join(root, 'examples', 'quickstart', 'app', 'server.mjs');
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, DEMO_APP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Quickstart server did not start. ${stderr}`)), 8000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });

  const response = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { Origin: base, 'X-Demo-Action': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sample project', eventId: 'evt-test-1' })
  });
  assert.equal(response.status, 202);
  const resend = await fetch(`${base}/api/resend`, {
    method: 'POST',
    headers: { Origin: base, 'X-Demo-Action': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: 'evt-test-1' })
  });
  assert.equal(resend.status, 202);
  const state = await fetch(`${base}/api/state`).then((r) => r.json());
  assert.equal(state.revision, 1);
  assert.equal(state.eventId, 'evt-test-1');
  assert.equal(state.duplicateCount, 1);

  const rejected = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'X-Demo-Action': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Rejected project' })
  });
  assert.equal(rejected.status, 403);
  const localUrl = new URL(base);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: localUrl.hostname, port: localUrl.port, path: '/api/state', headers: { Host: 'not-local.example' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  assert.equal(badHostStatus, 403);
});
