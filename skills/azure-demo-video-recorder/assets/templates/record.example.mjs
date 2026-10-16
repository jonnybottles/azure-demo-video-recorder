// Example recorder. Copy and customize this module as video/<scenario>/record.mjs.
// Each shot records one page into frames + marks; the storyboard decides order, captions and cuts.
// Patterns here are the ones that worked: component spotlights over a diagram, alphabetical portal tours that only
// scroll down, run views by deep link (hover only), and app walkthroughs with a recorded wait for the real outcome.
// Narrated videos are paced to the script: write the storyboard lines first, run `npm run lines -- <scenario>`, copy
// the seconds per mark into LINES, and call pace.fill() after each mark so the take is long enough for its line.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, pause as sleep } from '../engine/paths.mjs';
import { findRun, hoverAll, openPortal, rgFragment, runFragment, subscriptionId } from '../engine/portal.mjs';
import { paceToScript } from '../engine/helpers.mjs';
import { clearSpotlight, installSpotlight, regionOf, spotlight } from '../engine/spotlight.mjs';

// ---- Fill these in for the project (fictional data only on screen) ----
const CONFIG = {
  architecture: path.join(REPO_ROOT, 'docs', 'architecture.html'), // local HTML with addressable diagram components
  resourceGroup: 'rg-demo-integration',
  // Group names alphabetically, matching the portal list, so the tour only scrolls down.
  tour: { workflows: ['la-demo-intake', 'la-demo-delivery'], messaging: ['sb-demo-integration'] },
  appUrl: 'http://127.0.0.1:5199/',
  workflowId: '/subscriptions/<subscription-id>/resourceGroups/rg-demo-integration/providers/Microsoft.Logic/workflows/la-demo-delivery',
  runActions: ['Parse command', 'Map to target', 'Apply update', 'Complete command']
};

// Replace these SVG titles or use selectors: ['#component'] for the actual diagram. Keep the narration cue marks.
const ARCHITECTURE_STEPS = [
  { mark: 'source', svgTitles: ['source'], label: 'Request source' },
  { mark: 'azure', svgTitles: ['gateway'], label: 'Azure workflow' },
  { mark: 'target', svgTitles: ['target'], label: 'Verified result' }
];

// Seconds of speech per shot and mark, from `npm run lines -- <scenario>` (empty until the script is written).
const LINES = {
  architecture: { source: 6.0, azure: 6.0, target: 6.0 },
  'app-submit': { form: 9.5, submitted: 8.0, verified: 10.0 }
};
const pace = paceToScript(LINES);

export async function setup(ctx) {
  const selected = process.argv.indexOf('--shot');
  if (selected >= 0 && process.argv[selected + 1]?.split(',').every((id) => id === 'architecture')) return;
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
      await page.goto(pathToFileURL(CONFIG.architecture).href);
      await installSpotlight(page);
      const steps = [];
      for (const step of ARCHITECTURE_STEPS) {
        const rect = await regionOf(page, { svgTitles: step.svgTitles, selectors: step.selectors, pad: 14 });
        if (!rect || rect.w <= 0 || rect.h <= 0) throw new Error(`Architecture spotlight target missing: ${step.label}`);
        steps.push({ ...step, rect });
      }
      await page.cursor.sync();
      await ctx.recorder.shot(page, 'architecture', async (s) => {
        const mark = pace.marker(s, 'architecture');
        await page.cursor.show(false);
        await page.waitForTimeout(150);
        s.mark('loaded'); // storyboard trims to this mark, so the blank page never shows
        await sleep(2000);
        await page.cursor.show(true);
        for (const [i, step] of steps.entries()) {
          mark(step.mark);
          // Omit the step badge if the diagram already numbers its flow.
          await spotlight(page, step.rect, { label: step.label, step: i + 1 });
          await page.cursor.moveTo({ x: Math.round(step.rect.x + step.rect.w / 2), y: Math.round(step.rect.y + step.rect.h * 0.55) });
          await pace.fill();
        }
        await clearSpotlight(page);
        s.mark('whole');
        await sleep(1000);
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
