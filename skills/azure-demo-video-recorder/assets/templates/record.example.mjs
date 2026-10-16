// Example recorder. Copy and customize this module as video/<scenario>/record.mjs.
// Each shot records one page into frames + marks; the storyboard decides order, captions and cuts.
// Patterns here are the ones that worked: fractional cursor paths over a diagram, alphabetical portal tours that only
// scroll down, run views by deep link (hover only), and app walkthroughs with a recorded wait for the real outcome.
// Narrated videos are paced to the script: write the storyboard lines first, run `npm run lines -- <scenario>`, copy
// the seconds per mark into LINES, and call pace.fill() after each mark so the take is long enough for its line.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, pause as sleep } from '../engine/paths.mjs';
import { findRun, hoverAll, openPortal, rgFragment, runFragment, subscriptionId } from '../engine/portal.mjs';
import { paceToScript } from '../engine/helpers.mjs';

// ---- Fill these in for the project (fictional data only on screen) ----
const CONFIG = {
  architecture: path.join(REPO_ROOT, 'docs', 'architecture.html'), // local HTML or image showing the architecture
  resourceGroup: 'rg-demo-integration',
  // Group names alphabetically, matching the portal list, so the tour only scrolls down.
  tour: { workflows: ['la-demo-intake', 'la-demo-delivery'], messaging: ['sb-demo-integration'] },
  appUrl: 'http://127.0.0.1:5199/',
  workflowId: '/subscriptions/<subscription-id>/resourceGroups/rg-demo-integration/providers/Microsoft.Logic/workflows/la-demo-delivery',
  runActions: ['Parse command', 'Map to target', 'Apply update', 'Complete command']
};

// Seconds of speech per shot and mark, from `npm run lines -- <scenario>` (empty until the script is written).
const LINES = {
  'app-submit': { form: 9.5, submitted: 8.0, verified: 10.0 }
};
const pace = paceToScript(LINES);

export async function setup(ctx) {
  ctx.state.subscription ??= await subscriptionId();
  // If an App Service Authentication (Easy Auth) app rejects cookie-only writes with an empty 403, attach a short-lived
  // owner token to that host only (never print or store it):
  // await ctx.context.route((url) => url.host === 'app.example.com',
  //   (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }));
}

export async function teardown() {}

export const shots = [
  {
    id: 'architecture',
    async run(ctx) {
      const page = await ctx.page('deck', 'about:blank');
      await ctx.recorder.shot(page, 'architecture', async (s) => {
        await page.goto(pathToFileURL(CONFIG.architecture).href);
        await page.cursor.show(false);
        await page.waitForTimeout(150);
        s.mark('loaded'); // storyboard trims to this mark, so the blank page never shows
        await sleep(2000);
        const box = await page.evaluate(() => {
          const items = [...document.querySelectorAll('img, svg, canvas')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 400);
          items.sort((a, b) => b.width * b.height - a.width * a.height);
          const r = items[0] ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        const at = (fx, fy) => ({ x: Math.round(box.x + box.w * fx), y: Math.round(box.y + box.h * fy) });
        await page.cursor.moveTo(at(0.15, 0.5), { ms: 10 });
        await page.cursor.show(true);
        s.mark('source');
        await page.cursor.hover(at(0.15, 0.5), 2400);
        s.mark('azure');
        await page.cursor.hover(at(0.5, 0.5), 2400);
        s.mark('target');
        await page.cursor.hover(at(0.85, 0.5), 2400);
      });
    }
  },
  {
    id: 'azure-resources',
    async run(ctx) {
      const page = await ctx.page('portal');
      const first = Object.values(CONFIG.tour)[0][0];
      await openPortal(page, rgFragment(ctx.state.subscription, CONFIG.resourceGroup), { waitFor: first });
      await sleep(1500);
      await ctx.recorder.shot(page, 'azure-resources', async (s) => {
        await page.cursor.sync();
        await sleep(1000);
        for (const [mark, names] of Object.entries(CONFIG.tour)) {
          s.mark(mark);
          await hoverAll(page, page.cursor, names, { dwell: 1200 });
        }
        await sleep(600);
      });
    }
  },
  {
    id: 'app-submit',
    async run(ctx) {
      const page = await ctx.page('app', CONFIG.appUrl);
      await page.cursor.sync();
      await ctx.recorder.shot(page, 'app-submit', async (s) => {
        const mark = pace.marker(s, 'app-submit');
        await sleep(900);
        mark('form');
        await page.cursor.type(page.locator('#name'), 'Sample project 1042', { delay: 45 });
        await page.cursor.select(page.locator('#status'), 'Active'); // native <select>: set after a visible click
        await pace.fill(); // the typing counts towards the line spoken at 'form'
        mark('submitted');
        await page.cursor.click(page.locator('#submit'));
        ctx.state.submittedAt = Date.now();
        ctx.save();
        await pace.fill();
        // Record the real wait; the storyboard keeps a few seconds of it and cuts the rest.
        await s.wait('delivery', () => page.locator('#status-badge').filter({ hasText: /Verified/ }).waitFor({ timeout: 180000 }));
        mark('verified');
        await page.cursor.hover(page.locator('#readback'), 1800);
        await pace.fill();
      });
    }
  },
  {
    id: 'run-view',
    async run(ctx) {
      const run = await findRun(CONFIG.workflowId, { after: ctx.state.submittedAt });
      const page = await ctx.page('portal');
      await openPortal(page, runFragment(run.id), { waitFor: CONFIG.runActions[0] });
      await sleep(2000);
      await ctx.recorder.shot(page, 'run-view', async (s) => {
        await page.cursor.sync();
        await sleep(800);
        s.mark('steps');
        // Hover only: clicking a run card opens its inputs and outputs (data you should not show).
        await hoverAll(page, page.cursor, CONFIG.runActions, { dwell: 1250 });
        await sleep(500);
      });
    }
  }
];
