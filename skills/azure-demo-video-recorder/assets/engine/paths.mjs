import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(VIDEO_ROOT, '..');
export const LOCAL = path.join(REPO_ROOT, '.local', 'video');
export const PROFILE = path.resolve(process.env.DEMO_PROFILE_DIR ?? path.join(LOCAL, 'browser-profile'));
export const VIEWPORT = { width: 1920, height: 1080 };
export const FPS = 30;

export const scenarioDir = (id) => path.join(VIDEO_ROOT, id);
export const rawDir = (id) => path.join(LOCAL, id, 'raw');
export const workDir = (id) => path.join(LOCAL, id, 'work');
export const outDir = (id) => path.join(VIDEO_ROOT, 'out', id);
export const cardCache = () => path.join(LOCAL, 'cards');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pacing for on-camera pauses and cursor dwell (1 = brisk). Raise to slow the demo down; keeps typing speed natural.
export const PACE = Number(process.env.DEMO_PACE ?? 1.7);
export const pause = (ms) => sleep(ms * PACE);

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
