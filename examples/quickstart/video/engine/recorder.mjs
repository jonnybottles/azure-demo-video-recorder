import fs from 'node:fs';
import path from 'node:path';
import { VIEWPORT, rawDir, ensureDir, writeJson, sleep } from './paths.mjs';

const now = () => Date.now() / 1000;

// Records one "shot" from a single page as high-quality JPEG frames with arrival timestamps, plus named marks and
// wait ranges. The builder turns these into constant-frame-rate video and uses marks to place captions and cuts.
export class Recorder {
  constructor(scenarioId) {
    this.scenarioId = scenarioId;
    this.dir = ensureDir(rawDir(scenarioId));
  }

  async shot(page, id, fn) {
    const dir = path.join(this.dir, id);
    fs.rmSync(dir, { recursive: true, force: true });
    ensureDir(dir);
    const frames = [];
    const marks = [];
    const waits = [];
    const writes = [];
    let count = 0;
    const t0 = now();
    const control = {
      page,
      mark: (name) => { marks.push({ name, t: now() - t0 }); },
      elapsed: () => now() - t0,
      wait: async (name, action) => {
        const start = now() - t0;
        try { return await action(); } finally { waits.push({ name, start, end: now() - t0 }); }
      }
    };
    await page.screencast.start({
      size: VIEWPORT,
      quality: 92,
      onFrame: ({ data }) => {
        const file = `f${String(++count).padStart(6, '0')}.jpg`;
        frames.push({ file, t: now() - t0 });
        writes.push(fs.promises.writeFile(path.join(dir, file), data));
      }
    });
    // Force one repaint so the first frame arrives even if the page is idle.
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.02;pointer-events:none';
      document.documentElement.appendChild(d);
      setTimeout(() => d.remove(), 120);
    }).catch(() => {});
    let error;
    try {
      await fn(control);
    } catch (e) {
      error = e;
    } finally {
      await sleep(150);
      await page.screencast.stop().catch(() => {});
      await Promise.all(writes);
    }
    const end = now() - t0;
    writeJson(path.join(dir, 'shot.json'), { id, end, frames, marks, waits, failed: error ? String(error.message ?? error) : undefined });
    if (error) throw error;
    console.log(`  shot ${id}: ${end.toFixed(1)}s, ${frames.length} frames, ${marks.length} marks, ${waits.length} waits`);
    return { end, frames: frames.length };
  }
}
