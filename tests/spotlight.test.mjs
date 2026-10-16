import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { browserLaunchOptions } from '../skills/azure-demo-video-recorder/assets/engine/browser.mjs';
import { Cursor, cursorInitScript } from '../skills/azure-demo-video-recorder/assets/engine/cursor.mjs';

const root = path.resolve('.');

async function fixture(t, { missingTarget = false } = {}) {
  const local = path.join(root, '.local');
  fs.mkdirSync(local, { recursive: true });
  const directory = fs.mkdtempSync(path.join(local, 'spotlight-test-'));
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const scaffold = spawnSync(process.execPath, [
    path.join(root, 'skills', 'azure-demo-video-recorder', 'scripts', 'new-demo-video.mjs'),
    '--target', directory, '--scenarios', 'sample', '--skip-install'
  ], { encoding: 'utf8' });
  assert.equal(scaffold.status, 0, scaffold.stderr);
  fs.mkdirSync(path.join(directory, 'docs'));
  let html = fs.readFileSync(path.join(root, 'examples', 'quickstart', 'docs', 'architecture.html'), 'utf8');
  if (missingTarget) html = html.replace('<title>gateway</title>', '<title>missing</title>');
  fs.writeFileSync(path.join(directory, 'docs', 'architecture.html'), html);
  const recorder = await import(pathToFileURL(path.join(directory, 'video', 'sample', 'record.mjs')).href);
  browser = await chromium.launch(browserLaunchOptions());
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript({ content: cursorInitScript });
  const page = await context.newPage();
  page.cursor = new Cursor(page);
  const marks = [];
  const states = [];
  const move = page.cursor.moveTo.bind(page.cursor);
  page.cursor.moveTo = async (...args) => {
    await move(...args);
    states.push(await page.evaluate(() => {
      const spot = document.getElementById('__spot');
      const label = document.getElementById('__spot_label');
      const box = (element) => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        label: label.textContent, region: box(spot), labelBox: box(label),
        shadow: spot.style.boxShadow, border: spot.style.borderColor,
        opacity: spot.style.opacity
      };
    }));
  };
  let recorded = false;
  const ctx = {
    async page() { return page; },
    recorder: {
      async shot(_page, id, action) {
        recorded = true;
        assert.equal(id, 'architecture');
        await action({ mark: (name) => marks.push(name) });
      }
    }
  };
  return { run: () => recorder.shots.find((shot) => shot.id === 'architecture').run(ctx), page, marks, states, recorded: () => recorded };
}

test('a fresh scaffold walks actual components with numbered cyan spotlights, then clears the effect', { timeout: 60000 }, async (t) => {
  const demo = await fixture(t);
  await demo.run();
  assert.deepEqual(demo.marks, ['loaded', 'source', 'azure', 'target', 'whole']);
  assert.deepEqual(demo.states.map((state) => state.label), ['1Request source', '2Azure workflow', '3Verified result']);
  assert.ok(demo.states[0].region.x < demo.states[1].region.x && demo.states[1].region.x < demo.states[2].region.x);
  for (const state of demo.states) {
    assert.equal(state.opacity, '1');
    assert.match(state.shadow, /9999px/);
    assert.match(state.border.replaceAll(' ', ''), /80,230,255/);
    for (const rect of [state.region, state.labelBox]) {
      assert.ok(rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0
        && rect.x + rect.width <= 1920 && rect.y + rect.height <= 1080, 'Focus and label must fit the frame.');
    }
  }
  const cleared = await demo.page.evaluate(() => ['__spot', '__spot_label'].map((id) => getComputedStyle(document.getElementById(id)).opacity));
  assert.deepEqual(cleared, ['0', '0']);
});

test('a missing architecture component fails before recording instead of falling back to cursor hovers', async (t) => {
  const demo = await fixture(t, { missingTarget: true });
  await assert.rejects(demo.run, /Architecture spotlight target missing: Azure workflow/);
  assert.equal(demo.recorded(), false);
  assert.deepEqual(demo.states, []);
});
