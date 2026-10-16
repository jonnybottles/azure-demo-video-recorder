import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, newPage } from './browser.mjs';
import { Cursor } from './cursor.mjs';
import { Recorder } from './recorder.mjs';
import { build, loadStoryboard, speakable, spokenLines } from './builder.mjs';
import { narrationClip } from './voice.mjs';
import { renderCards, cardSeconds } from './titles.mjs';
import { prepareTerms } from './redact.mjs';
import { qa } from './qa.mjs';
import { LOCAL, VIDEO_ROOT, ensureDir, outDir, rawDir, readJson, scenarioDir, writeJson, sleep } from './paths.mjs';
import { X264, duration, ffmpeg, run } from './ffmpeg.mjs';

const [command, scenario, ...rest] = process.argv.slice(2);
const all = process.argv.slice(2);
const flag = (name) => all.includes(`--${name}`);
const option = (name) => { const i = all.indexOf(`--${name}`); return i >= 0 ? all[i + 1] : undefined; };
// A scenario is any folder next to engine\ that has a storyboard.yaml.
const SCENARIOS = fs.readdirSync(VIDEO_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(VIDEO_ROOT, d.name, 'storyboard.yaml'))).map((d) => d.name);

function requireScenario() {
  if (!SCENARIOS.includes(scenario)) {
    console.error(`Usage: npm run ${command} -- <${SCENARIOS.join('|')}> [options]`);
    process.exit(2);
  }
}

// Google (Gmail) and some other identity providers refuse sign-in in a browser that automation launched ("This
// browser or app may not be secure"). --manual opens the installed Chrome on the same isolated profile with no
// automation attached; the person signs in and closes the window, and recordings (DEMO_BROWSER=chrome) reuse it.
async function signinManual() {
  const { spawn } = await import('node:child_process');
  const { PROFILE } = await import('./paths.mjs');
  const candidates = process.env.DEMO_CHROME ? [process.env.DEMO_CHROME]
    : process.platform === 'win32' ? [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
      : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  const chrome = candidates.find((c) => c && fs.existsSync(c));
  if (!chrome) throw new Error('Google Chrome was not found; set DEMO_CHROME to its executable.');
  ensureDir(PROFILE);
  const url = option('url') ?? 'about:blank';
  console.log('A normal Chrome window is opening on the recording profile. Sign in, then close the window (the X) to save the session.');
  console.log('Record with DEMO_BROWSER=chrome so the same Chrome version reads the profile.');
  const child = spawn(chrome, [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', url], { stdio: 'ignore' });
  await new Promise((resolve) => child.on('exit', resolve));
  console.log('Chrome closed; the session is saved in the recording profile.');
}

async function signin() {
  if (flag('manual')) return signinManual();
  prepareTerms();
  const context = await launch({ headless: false });
  const page = await newPage(context);
  // Default: the Azure portal in the signed-in Azure CLI tenant. --url signs in to any other site instead.
  const { portalTenant } = await import('./portal.mjs');
  const target = new URL(option('url') ?? `https://portal.azure.com/#@${await portalTenant()}/home`);
  await page.goto(target.href);
  console.log('A dedicated browser window is open. Sign in to the intended Azure tenant and complete its normal prompts.');
  console.log('This window closes by itself once the site has loaded, which saves the session for recording.');
  let closed = false;
  context.on('close', () => { closed = true; });
  const deadline = Date.now() + 60 * 60 * 1000;
  // --ready <text>: text that only shows once signed in (e.g. a project name). Without it, any page on the target
  // host counts, which is too early for sites whose signed-out landing page lives on the same host (ai.azure.com).
  const ready = option('ready');
  let signedInSince = 0;
  while (!closed && Date.now() < deadline) {
    await sleep(3000);
    let onPortal = await page.evaluate((host) => location.host === host && (host !== 'portal.azure.com' || Boolean(document.querySelector('.fxs-topbar, [class*="fxs-topbar"]'))), target.host).catch(() => false);
    if (onPortal && ready) onPortal = await page.getByText(ready).first().isVisible().catch(() => false);
    if (onPortal && target.host !== 'portal.azure.com') {
      onPortal = !(await page.getByRole('button', { name: /^sign in$/i }).first().isVisible().catch(() => false));
    }
    signedInSince = onPortal ? (signedInSince || Date.now()) : 0;
    if (signedInSince && Date.now() - signedInSince > 8000) {
      console.log('Signed in. Saving the session...');
      await sleep(4000);
      await context.close();
      console.log('Session saved in .local\\video\\browser-profile. You can record now.');
      return;
    }
  }
  if (!closed) await context.close();
  console.log(closed ? 'The window was closed before sign-in completed.' : 'Timed out waiting for sign-in.');
  process.exitCode = 1;
}

async function record() {
  requireScenario();
  const module = await import(pathToFileURL(path.join(scenarioDir(scenario), 'record.mjs')).href);
  const only = option('shot')?.split(',');
  const stateFile = path.join(LOCAL, scenario, 'state.json');
  const context = await launch({ headless: !flag('headed'), ephemeral: flag('ephemeral') });
  const ctx = {
    context,
    recorder: new Recorder(scenario),
    state: readJson(stateFile, {}),
    save() { writeJson(stateFile, ctx.state); },
    async page(name, url) {
      ctx.pages ??= {};
      if (!ctx.pages[name]) {
        ctx.pages[name] = await (Object.keys(ctx.pages).length ? context.newPage() : newPage(context));
        ctx.pages[name].cursor = new Cursor(ctx.pages[name]);
      }
      const page = ctx.pages[name];
      if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      return page;
    },
    sleep
  };
  try {
    await module.setup?.(ctx);
    for (const shot of module.shots) {
      if (only && !only.includes(shot.id)) continue;
      console.log(`Recording ${shot.id}...`);
      await shot.run(ctx);
      ctx.save();
    }
  } finally {
    ctx.save();
    await module.teardown?.(ctx).catch(() => {});
    await context.close();
  }
}

async function titles() {
  requireScenario();
  const board = loadStoryboard(scenario);
  const specs = [];
  for (const scene of board.scenes) {
    if (scene.card) specs.push(scene.card);
    for (const shot of scene.shots ?? []) for (const policy of Object.values(shot.waits ?? {})) if (policy?.title) specs.push({ type: 'timeskip', ...policy });
  }
  const files = await renderCards(specs);
  const dir = ensureDir(path.join(LOCAL, scenario, 'preview'));
  for (const [i, file] of files.entries()) {
    const at = Math.max(0.5, cardSeconds(specs[i]) - 0.6);
    await ffmpeg(['-ss', String(at), '-i', file, '-frames:v', '1', path.join(dir, `card-${String(i + 1).padStart(2, '0')}.png`)]);
  }
  console.log(`Rendered ${files.length} cards; previews in ${dir}`);
}

// Every spoken line with its length, from the storyboard alone (no takes needed): the narration budget per shot, so
// a recorder's dwell at each mark can be sized before anything is recorded. Clips come from the same TTS cache the
// build uses, so nothing is synthesized twice. --no-voice (or no voice:, or a voice error such as a missing API key)
// prints the reading-time estimate instead, marked with ~.
async function lines() {
  requireScenario();
  const board = loadStoryboard(scenario);
  const { pronounce, ...ttsVoice } = board.voice ?? {};
  let synth = Boolean(board.voice) && !flag('no-voice');
  const rows = spokenLines(board);
  let total = 0;
  for (const r of rows) {
    const text = speakable(r.text, pronounce);
    let seconds;
    let mark = '';
    if (synth) {
      try { ({ seconds } = await narrationClip(text, ttsVoice)); }
      catch (e) { console.warn(`  voice unavailable, estimating the rest: ${String(e.message).split('\n')[0]}`); synth = false; }
    }
    if (seconds === undefined) { seconds = text.trim().split(/\s+/).length / 2.7 + 0.6; mark = '~'; }
    total += seconds;
    console.log(`${r.shot.padEnd(18)} ${r.at.padEnd(16)} ${(mark + seconds.toFixed(1)).padStart(6)}s  ${text}`);
  }
  console.log(`${rows.length} lines, ${total.toFixed(1)}s of speech${synth ? '' : ' (~ estimated at words / 2.7 + 0.6)'}`);
}

// Re-times the finished outputs of a scenario without re-recording or rebuilding: the video clock runs faster
// (setpts) and the narration is time-stretched with its pitch kept (atempo), so speech stays in sync with what it
// describes. Writes <output>-<version>-<factor>x.mp4 next to the originals, which stay as they are. Each file is one
// re-encode (a few minutes, light on memory). 1.1-1.15 still sounds like a natural reader; 1.25 sounds hurried.
async function speed() {
  requireScenario();
  const factor = Number(rest.find((r) => !r.startsWith('--')));
  if (!(factor >= 0.5 && factor <= 2) || factor === 1) {
    console.error('Usage: npm run speed -- <scenario> <factor> (0.5 to 2, not 1; 1.15 is a brisk read, 1.25 is hurried)');
    process.exit(2);
  }
  const board = loadStoryboard(scenario);
  const out = outDir(scenario);
  const report = readJson(path.join(out, 'build-report.json'), {});
  const versions = report.versions ?? board.versions ?? ['clean', 'captions-voice'];
  const label = `${String(factor).replace(/\.?0+$/, '')}x`;
  const minutes = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  for (const version of versions) {
    const source = path.join(out, `${board.output}-${version}.mp4`);
    if (!fs.existsSync(source)) { console.warn(`  ${path.basename(source)} is not built yet; skipped`); continue; }
    const target = path.join(out, `${board.output}-${version}-${label}.mp4`);
    const streams = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', source]);
    const hasAudio = /audio/.test(streams);
    const graph = [`[0:v]setpts=PTS/${factor}[v]`, ...(hasAudio ? [`[0:a]atempo=${factor}[a]`] : [])].join(';');
    await ffmpeg(['-i', source, '-filter_complex', graph, '-map', '[v]', ...(hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      ...X264, '-movflags', '+faststart', target]);
    console.log(`${path.basename(target)}: ${minutes(await duration(source))} -> ${minutes(await duration(target))}`);
  }
}

// Saves one recorded frame (at a mark plus an offset, or the end) as a JPEG for a quick visual check. With
// --to <mark> [--step 0.25] it saves every frame from the first mark to the second instead, for a frame-by-frame check.
// Takes come from the storyboard's `takesFrom:` scenario when it has one.
async function frame() {
  const [shot, mark = 'end', offset = '0'] = rest.filter((r, i, all) => !r.startsWith('--') && !['--to', '--step'].includes(all[i - 1]));
  const dir = path.join(rawDir(loadStoryboard(scenario).takesFrom ?? scenario), shot);
  const meta = readJson(path.join(dir, 'shot.json'));
  const at = (name, plus = 0) => (name === 'end' ? meta.end - 0.2 : (meta.marks.find((m) => m.name === name)?.t ?? 0) + Number(plus));
  const pick = (t) => meta.frames.filter((f) => f.t <= t).at(-1) ?? meta.frames[0];
  const preview = ensureDir(path.join(LOCAL, scenario, 'preview'));
  const to = option('to');
  if (to) {
    const step = Number(option('step') ?? 0.25);
    const target = ensureDir(path.join(preview, `${shot}-${mark}-frames`));
    for (const f of fs.readdirSync(target)) fs.rmSync(path.join(target, f), { recursive: true, force: true });
    let n = 0;
    for (let t = at(mark, offset); t <= at(to) + 1e-6; t += step) {
      fs.copyFileSync(path.join(dir, pick(t).file), path.join(target, `${String(++n).padStart(4, '0')}-${t.toFixed(2)}s.jpg`));
    }
    console.log(`${n} frames, every ${step}s from ${mark} to ${to}: ${target}`);
    return;
  }
  const suffix = Number(offset) ? `+${Number(offset)}` : '';
  const target = path.join(preview, `${shot}-${mark}${suffix}.jpg`);
  fs.copyFileSync(path.join(dir, pick(at(mark, offset)).file), target);
  console.log(target);
}

switch (command) {
  case 'signin': await signin(); break;
  case 'prepare': console.log(`Prepared ${prepareTerms().length} redaction terms in .local\\video\\redact.json`); break;
  case 'record': await record(); break;
  case 'build': requireScenario(); await build(scenario, { only: option('only'), partial: flag('partial'), plan: flag('plan'), voice: flag('no-voice') ? false : undefined }); break;
  case 'titles': await titles(); break;
  case 'lines': await lines(); break;
  case 'qa': requireScenario(); await qa(scenario, { every: Number(option('every') ?? 1), partial: flag('partial') }); break;
  case 'frame': requireScenario(); await frame(); break;
  case 'speed': await speed(); break;
  default:
    console.log('Commands: signin [--url u] [--ready text] [--manual] | prepare | record <scenario> [--shot a,b] [--headed] [--ephemeral] | build <scenario> [--plan] [--partial] [--no-voice] | titles <scenario> | lines <scenario> [--no-voice] | frame <scenario> <shot> [mark|end] [offset] [--to mark] [--step s] | qa <scenario> | speed <scenario> <factor>');
}
