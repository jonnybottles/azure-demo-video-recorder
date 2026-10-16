import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, pause as sleep } from '../engine/paths.mjs';
import { installSpotlight, regionOf, spotlight, clearSpotlight } from '../engine/spotlight.mjs';

const APP = 'http://127.0.0.1:5199/';
const ARCHITECTURE = pathToFileURL(path.join(REPO_ROOT, 'docs', 'architecture.html')).href;
const stateUrl = `${APP}api/state`;

async function appReady() {
  try { return (await fetch(APP)).ok; } catch { return false; }
}

export async function setup(ctx) {
  if (await appReady()) return;
  ctx.app = spawn(process.execPath, [path.join(REPO_ROOT, 'app', 'server.mjs')], {
    cwd: REPO_ROOT, stdio: 'ignore', windowsHide: true
  });
  const until = Date.now() + 15000;
  while (!(await appReady())) {
    if (ctx.app.exitCode !== null) throw new Error(`Synthetic app exited with code ${ctx.app.exitCode}.`);
    if (Date.now() > until) throw new Error('Synthetic app did not start on loopback port 5199.');
    await sleep(250);
  }
}

export async function teardown(ctx) {
  if (!ctx.app || ctx.app.exitCode !== null) return;
  ctx.app.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => ctx.app.once('exit', resolve)),
    sleep(3000).then(() => { if (ctx.app.exitCode === null) ctx.app.kill('SIGKILL'); })
  ]);
}

export const shots = [
  {
    id: 'architecture',
    async run(ctx) {
      const page = await ctx.page('architecture', 'about:blank');
      await page.goto(ARCHITECTURE);
      await installSpotlight(page);
      await ctx.recorder.shot(page, 'architecture', async (s) => {
        s.mark('loaded');
        await sleep(700);
        s.mark('overview');
        await sleep(1200);
        for (const [i, step] of [
          { mark: 'source', node: 'source', label: 'Partner sends an update' },
          { mark: 'gateway', node: 'gateway', label: 'Validate and queue' },
          { mark: 'target', node: 'target', label: 'Apply once and verify' }
        ].entries()) {
          const rect = await regionOf(page, { svgTitles: [step.node], pad: 14 });
          if (!rect) throw new Error(`Architecture spotlight target missing: ${step.label}`);
          s.mark(step.mark);
          await spotlight(page, rect, { label: step.label, step: i + 1 });
          await page.cursor.moveTo({ x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2) });
          await sleep(1700);
        }
        await clearSpotlight(page);
        s.mark('whole');
        await sleep(700);
      });
    }
  },
  {
    id: 'app-submit',
    async run(ctx) {
      const page = await ctx.page('partner-app', APP);
      await ctx.recorder.shot(page, 'app-submit', async (s) => {
        s.mark('form');
        await page.cursor.type(page.locator('#name'), 'Sample project 1042', { delay: 35 });
        await page.cursor.click(page.locator('#submit'));
        await page.locator('#badge').filter({ hasText: 'Verified' }).waitFor({ timeout: 5000 });
        s.mark('verified');
        await page.cursor.hover(page.locator('#readback'), 800);
        ctx.state.eventId = await page.locator('#event-id').textContent();
        ctx.state.submittedAt = Date.now();
        ctx.save();
      });
    }
  },
  {
    id: 'app-duplicate',
    async run(ctx) {
      const page = await ctx.page('partner-app', APP);
      await page.reload();
      await page.locator('#resend').waitFor({ state: 'visible' });
      await ctx.recorder.shot(page, 'app-duplicate', async (s) => {
        s.mark('resend');
        await page.cursor.click(page.locator('#resend'));
        await page.locator('#badge').filter({ hasText: 'No second effect' }).waitFor({ timeout: 5000 });
        s.mark('unchanged');
        await page.cursor.hover(page.locator('#revision'), 900);
      });
    }
  }
];
