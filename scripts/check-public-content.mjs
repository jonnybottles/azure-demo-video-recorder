import { isUtf8 } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const reviewedMedia = new Map([
  ['docs/preview.gif', 'c2226d1e8a64a3db52ab5ad763ccf3f9e52d6224e14312861c44c7124e5cd745']
]);

const rules = [
  ['company-package-feed', /\bpkgs\.(?:visualstudio|dev\.azure)\.com\b/i],
  ['tenant-domain', /\b[a-z0-9][a-z0-9-]*\.(?:onmicrosoft\.com|sharepoint\.com)\b/i],
  ['guid-literal', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['user-home-path', /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'<>]+/i],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential-literal', /\bgh[pousr]_[A-Za-z0-9]{24,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bsk-[A-Za-z0-9_-]{24,}\b|\bAIza[A-Za-z0-9_-]{30,}\b/],
  ['deployed-endpoint', /\b[a-z0-9-]+\.(?:scm\.)?(?:azurewebsites\.net|azure-api\.net|servicebus\.windows\.net|(?:blob|table|queue|file|dfs)\.core\.windows\.net|vault\.azure\.net|logic\.azure\.com|eventgrid\.azure\.net|services\.ai\.azure\.com|openai\.azure\.com|cognitiveservices\.azure\.com|(?:[a-z0-9-]+\.)?azurecontainerapps\.io)\b/i]
];

function documentationIp(address) {
  const octets = address.split('.').map(Number);
  if (octets.some((part) => part > 255)) return false;
  return address === '0.0.0.0' || octets[0] === 127 ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
    (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113);
}

export function scanText(text, file) {
  const findings = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const report = (rule) => findings.push({ path: file, line: index + 1, rule });
    for (const [name, pattern] of rules) if (pattern.test(line)) report(name);
    const emails = [...line.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)];
    if (emails.some((match) => !/(?:^|\.)example\.(?:com|org|net)$/i.test(match[1]))) report('non-example-email');
    const ips = [...line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)];
    if (ips.some((match) => !documentationIp(match[0]))) report('ip-address');
  }
  return findings;
}

export function scanLockfile(text, file) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return [{ path: file, line: 1, rule: 'invalid-lockfile-json' }];
  }
  if (!lock?.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    return [{ path: file, line: 1, rule: 'missing-lockfile-packages' }];
  }
  const findings = [];
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    const report = (rule) => findings.push({ path: file, line: 1, rule, package: name });
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      report('invalid-lockfile-entry');
      continue;
    }
    if (entry.link) {
      report('local-package-link-requires-review');
      continue;
    }
    let url;
    try {
      url = new URL(entry.resolved);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      report('missing-public-package-resolution');
      continue;
    }
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.search || url.hash) {
      report('non-public-package-resolution');
    }
    if (typeof entry.integrity !== 'string' || !/^sha(?:512|384|256|1)-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)) {
      report('missing-package-integrity');
    }
  }
  return findings;
}

export function scanRepository(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }).split('\0').filter(Boolean);
  const findings = [];
  const binaryFiles = [];
  for (const file of [...new Set(files)].sort()) {
    const full = path.join(root, file);
    if (!fs.lstatSync(full).isFile()) {
      findings.push({ path: file, line: 1, rule: 'unsupported-file-type' });
      continue;
    }
    const content = fs.readFileSync(full);
    if (content.includes(0) || !isUtf8(content)) {
      binaryFiles.push(file);
      const digest = createHash('sha256').update(content).digest('hex');
      if (reviewedMedia.get(file) !== digest) findings.push({ path: file, line: 1, rule: 'unreviewed-binary' });
      continue;
    }
    const text = content.toString('utf8');
    findings.push(...scanText(text, file));
    if (path.basename(file) === 'package-lock.json') findings.push(...scanLockfile(text, file));
  }
  return { findings, files: files.length, binaryFiles };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = scanRepository(path.resolve('.'));
  for (const finding of report.findings) console.error(`${finding.path}:${finding.line}: ${finding.rule}`);
  if (report.findings.length) {
    console.error(`Public-content check failed: ${report.findings.length} finding(s); matched values are not logged.`);
    process.exitCode = 1;
  } else {
    console.log(`Public-content check passed for ${report.files} files; ${report.binaryFiles.length} reviewed binary file(s) unchanged.`);
    console.log('Git history and GitHub artifacts require a separate release audit.');
  }
}
