#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(skillRoot, 'assets');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(name);
const targetArg = value('--target');
if (!targetArg) {
  console.error('Usage: node scripts/new-demo-video.mjs --target <repo-root> [--scenarios scenario-1,scenario-2] [--refresh-engine] [--skip-install] [--install-browser]');
  process.exit(2);
}

const target = path.resolve(targetArg);
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`Target folder does not exist: ${target}`);
const scenarios = String(value('--scenarios', 'scenario-1')).split(',').map((s) => s.trim()).filter(Boolean);
if (scenarios.some((s) => !/^[a-z0-9-]+$/.test(s))) throw new Error('Scenario names must be lowercase letters, digits and hyphens.');
const video = path.join(target, 'video');
const engine = path.join(video, 'engine');
const titles = path.join(video, 'titles');
fs.mkdirSync(engine, { recursive: true });
fs.mkdirSync(titles, { recursive: true });

if (fs.existsSync(path.join(engine, 'cli.mjs')) && !flag('--refresh-engine')) {
  console.log('video/engine already exists; keeping it. Use --refresh-engine to replace it with this skill version.');
} else {
  fs.cpSync(path.join(assets, 'engine'), engine, { recursive: true, force: true });
  fs.copyFileSync(path.join(assets, 'titles', 'card.html'), path.join(titles, 'card.html'));
}
for (const file of ['package.json', 'README.md']) {
  const destination = path.join(video, file);
  const source = file === 'README.md' ? path.join(assets, 'templates', file) : path.join(assets, file);
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
}
// A refreshed engine may bring new npm scripts (lines, speed) and dependencies: add the missing ones to the
// project's package.json, never changing a script or version the project already has.
if (flag('--refresh-engine')) {
  const file = path.join(video, 'package.json');
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  const skill = JSON.parse(fs.readFileSync(path.join(assets, 'package.json'), 'utf8'));
  const added = [];
  for (const key of ['scripts', 'dependencies']) {
    for (const [name, spec] of Object.entries(skill[key] ?? {})) {
      if (project[key]?.[name] === undefined) { (project[key] ??= {})[name] = spec; added.push(name); }
    }
  }
  if (added.length) {
    if (project.dependencies) project.dependencies = Object.fromEntries(Object.entries(project.dependencies).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
    console.log(`Added to video/package.json: ${added.join(', ')}`);
  }
}
for (const scenario of scenarios) {
  const directory = path.join(video, scenario);
  fs.mkdirSync(directory, { recursive: true });
  for (const [source, destination] of [['storyboard.example.yaml', 'storyboard.yaml'], ['record.example.mjs', 'record.mjs']]) {
    const file = path.join(directory, destination);
    if (!fs.existsSync(file)) fs.copyFileSync(path.join(assets, 'templates', source), file);
  }
}

const ignoreFile = path.join(target, '.gitignore');
const current = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '';
const entries = ['.local/', 'video/node_modules/', 'video/out/'];
const missing = entries.filter((entry) => !current.split(/\r?\n/).includes(entry));
if (missing.length) fs.appendFileSync(ignoreFile, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);

const missingTools = [['node', '--version'], ['npm', '--version'], ['ffmpeg', '-version'], ['ffprobe', '-version']]
  .filter(([tool, flag]) => spawnSync(tool, [flag], { stdio: 'ignore', shell: process.platform === 'win32' }).status !== 0)
  .map(([tool]) => tool);
if (missingTools.length) console.warn(`Missing prerequisites: ${missingTools.join(', ')}`);

if (!flag('--skip-install')) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: video, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`npm install failed with exit code ${result.status}.`);
  if (flag('--install-browser')) {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const browser = spawnSync(npx, ['playwright', 'install', 'chromium'], { cwd: video, stdio: 'inherit', shell: process.platform === 'win32' });
    if (browser.status !== 0) throw new Error(`Playwright Chromium installation failed with exit code ${browser.status}.`);
  }
}
console.log(`Scaffolded ${video} for: ${scenarios.join(', ')}`);
console.log('Next: edit each storyboard.yaml and record.mjs, then run npm run signin, record, build and qa.');
