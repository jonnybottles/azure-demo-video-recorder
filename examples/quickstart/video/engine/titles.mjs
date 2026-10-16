import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './browser.mjs';
import { FPS, VIDEO_ROOT, VIEWPORT, cardCache, ensureDir } from './paths.mjs';
import { ffmpeg, X264 } from './ffmpeg.mjs';

const TEMPLATE = path.join(VIDEO_ROOT, 'titles', 'card.html');
const DEFAULT_SECONDS = { intro: 6.5, section: 3.2, timeskip: 2.2, closing: 7.5, bullets: 8, end: 7, usecase: 12 };

export const cardSeconds = (spec) => Number(spec.seconds ?? DEFAULT_SECONDS[spec.type] ?? 3);

function cardKey(spec) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  // Narration is spoken, not drawn: leave it out of the key so a wording change does not re-render the card.
  const { narration, ...drawn } = spec;
  return crypto.createHash('sha256').update(template).update(JSON.stringify(drawn)).digest('hex').slice(0, 16);
}

// Renders a card frame-by-frame by seeking its CSS animations, so output is smooth and identical on every build.
export async function renderCards(specs) {
  const dir = ensureDir(cardCache());
  const files = specs.map((spec) => path.join(dir, `${spec.type}-${cardKey(spec)}.mp4`));
  const pending = specs.map((spec, i) => ({ spec, file: files[i] })).filter(({ file }) => !fs.existsSync(file));
  if (pending.length) {
    const browser = await chromium.launch(browserLaunchOptions());
    try {
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      for (const { spec, file } of pending) {
        await page.goto(pathToFileURL(TEMPLATE).href);
        await page.evaluate((s) => window.render(s), spec);
        await page.evaluate(() => document.fonts.ready);
        const frames = Math.round(cardSeconds(spec) * FPS);
        const shots = [];
        for (let i = 0; i < frames; i++) {
          await page.evaluate((ms) => window.seek(ms), (i * 1000) / FPS);
          shots.push(await page.screenshot({ type: 'jpeg', quality: 95 }));
        }
        const tmp = `${file}.tmp.mp4`;
        await ffmpeg(['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...X264, '-crf', '14', tmp], {
          input: (stdin) => { for (const s of shots) stdin.write(s); stdin.end(); }
        });
        fs.renameSync(tmp, file);
        console.log(`  card ${spec.type}: ${spec.title ?? ''} (${frames} frames)`);
      }
    } finally {
      await browser.close();
    }
  }
  return files;
}
