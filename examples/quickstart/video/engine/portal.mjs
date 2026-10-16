import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sleep } from './paths.mjs';

const exec = promisify(execFile);

export async function az(args) {
  const { stdout } = await exec('az', args, { shell: true, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

let tenantDomain;
let ownerUpn;
export async function portalTenant() {
  if (!tenantDomain) {
    const account = await az(['account', 'show', '-o', 'json']);
    ownerUpn = String(account.user.name);
    tenantDomain = account.tenantDefaultDomain ?? ownerUpn.split('@')[1] ?? account.tenantId;
  }
  return tenantDomain;
}

// Entra may show an account picker. Select only the already-signed-in intended account; never type credentials.
// If a password or MFA prompt is requested, pause and let the user complete it.
// Returns true when it acted on a sign-in page.
export async function handleLogin(page) {
  await portalTenant();
  if (!/login\.microsoftonline\.com|login\.live\.com/.test(new URL(page.url()).host)) return false;
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    throw new Error('The saved session has expired. Run: npm run signin');
  }
  const kmsi = page.locator('#KmsiCheckboxField');
  if (await kmsi.isVisible().catch(() => false)) {
    await kmsi.check().catch(() => {});
    await page.locator('#idSIButton9').click();
    await sleep(2500);
    return true;
  }
  const tile = page.locator(`[data-test-id="${ownerUpn}"], div[role="button"]:has-text("${ownerUpn}"), div[role="listitem"]:has-text("${ownerUpn}")`).first();
  if (await tile.isVisible().catch(() => false)) {
    await tile.click();
    await sleep(2500);
    return true;
  }
  return false;
}

export async function ensureSignedIn(page, { timeout = 90000 } = {}) {
  const until = Date.now() + timeout;
  let stableSince = 0;
  while (Date.now() < until) {
    const onLogin = /login\.microsoftonline\.com|login\.live\.com/.test(new URL(page.url()).host);
    if (onLogin) { stableSince = 0; await handleLogin(page); }
    else if (!stableSince) stableSince = Date.now();
    else if (Date.now() - stableSince > 4000) return;
    await sleep(700);
  }
  throw new Error('Could not reach the signed-in page. Run: npm run signin');
}

// A failing cosmetic step should not ruin a take: log it and keep recording.
export async function soft(label, action) {
  try {
    return await action();
  } catch (error) {
    console.warn(`    (skipped) ${label}: ${String(error.message ?? error).split('\n')[0]}`);
    return undefined;
  }
}

// The portal renders many blades inside iframes, so search every frame for visible text.
export async function findText(page, text, { exact = false, timeout = 30000, role } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const frame of page.frames()) {
      const locator = (role ? frame.getByRole(role, { name: text, exact }) : frame.getByText(text, { exact })).first();
      try {
        if (await locator.isVisible({ timeout: 50 })) return locator;
      } catch { /* detached frame */ }
    }
    await sleep(400);
  }
  throw new Error(`Text not visible: ${text}`);
}

export async function openPortal(page, fragment, { waitFor, timeout = 120000 } = {}) {
  const url = `https://portal.azure.com/#@${await portalTenant()}${fragment}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  const until = Date.now() + timeout;
  for (;;) {
    await handleLogin(page);
    const onPortal = new URL(page.url()).host === 'portal.azure.com';
    if (onPortal && (!waitFor || await findText(page, waitFor, { timeout: 1500 }).then(() => true, () => false))) break;
    if (Date.now() > until) throw new Error(`Portal page did not show: ${waitFor ?? fragment}`);
    await sleep(800);
  }
  await quietPortal(page);
}

// Closes transient portal chrome (tours, toasts, surveys) that would distract from the demo.
export async function quietPortal(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const name of [/^Maybe later$/i, /^Not now$/i, /^Dismiss$/i, /^Skip$/i, /^Close$/i]) {
    for (const frame of page.frames()) {
      const button = frame.getByRole('button', { name }).first();
      if (await button.isVisible({ timeout: 50 }).catch(() => false)) {
        const box = await button.boundingBox().catch(() => null);
        if (box && box.y > 40 && box.width < 400) await button.click({ timeout: 2000 }).catch(() => {});
      }
    }
  }
  await page.addStyleTag({ content: '.fxs-toast-container, .fxs-toast { display: none !important; }' }).catch(() => {});
}

// Microsoft Foundry portal (ai.azure.com). `url` is a full URL or a path such as '/build/agents'. Agents created
// with the v2 API only appear in the new Foundry experience, so never switch that toggle off here.
export async function openFoundry(page, url, { waitFor, timeout = 120000 } = {}) {
  const target = /^https?:/.test(url) ? url : `https://ai.azure.com${url.startsWith('/') ? '' : '/'}${url}`;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
  const until = Date.now() + timeout;
  for (;;) {
    await handleLogin(page);
    const onFoundry = new URL(page.url()).host === 'ai.azure.com';
    if (onFoundry && await foundrySignedOut(page)) {
      throw new Error('Foundry shows its signed-out page. Run: npm run signin -- --url https://ai.azure.com --ready <text>');
    }
    if (onFoundry && (!waitFor || await findText(page, waitFor, { timeout: 1500 }).then(() => true, () => false))) break;
    if (Date.now() > until) throw new Error(`Foundry page did not show: ${waitFor ?? url}`);
    await sleep(800);
  }
  await quietFoundry(page);
}

// The signed-out landing page of ai.azure.com has a "Sign in" button in its top bar.
export async function foundrySignedOut(page) {
  return page.getByRole('button', { name: /^sign in$/i }).first().isVisible({ timeout: 200 }).catch(() => false);
}

// Hides Foundry toasts and teaching callouts. Unlike quietPortal it never presses Escape or clicks "Close":
// in Foundry those shut playground and agent panels the demo needs.
export async function quietFoundry(page) {
  for (const name of [/^Got it$/i, /^Maybe later$/i, /^Not now$/i, /^No thanks$/i, /^Dismiss$/i]) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible({ timeout: 50 }).catch(() => false)) await button.click({ timeout: 2000 }).catch(() => {});
  }
  await page.addStyleTag({ content: '.fui-Toaster, .fui-Toast, .fui-TeachingPopoverSurface, [data-testid*="toast" i] { display: none !important; }' }).catch(() => {});
}

export const resourceFragment = (id, blade = 'overview') => `/resource${id}/${blade}`;
export const rgFragment = (subscriptionId, rg) => `/resource/subscriptions/${subscriptionId}/resourceGroups/${rg}/overview`;
export const runFragment = (runId) => `/view/Microsoft_Azure_EMA/LogicAppsMonitorBlade/runid/${encodeURIComponent(runId)}`;

export async function subscriptionId() {
  return (await az(['account', 'show', '-o', 'json'])).id;
}

// Finds the newest workflow run that started after a moment and finished with the expected status.
export async function findRun(workflowId, { after, status = 'Succeeded', timeout = 300000, filter } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const page = await az(['rest', '--method', 'get', '--url',
      `"https://management.azure.com${workflowId}/runs?api-version=2016-06-01&$top=25"`]);
    const runs = (page?.value ?? []).filter((r) => !after || Date.parse(r.properties.startTime) >= after - 5000);
    for (const run of runs) {
      if (run.properties.status !== status) continue;
      if (filter && !(await filter(run))) continue;
      return run;
    }
    await sleep(5000);
  }
  throw new Error(`No ${status} run of ${workflowId.split('/').pop()} found in time.`);
}

// Portal grids are virtualized: rows below the fold are not in the DOM until scrolled. Hover each name in order,
// wheeling the list down (where the cursor is) when a name has not been rendered yet.
export async function hoverAll(page, cursor, texts, { dwell = 900, exact = true, scrollSteps = 6 } = {}) {
  for (const text of texts) {
    await soft(`hover ${text}`, async () => {
      let target;
      for (let attempt = 0; attempt <= scrollSteps && !target; attempt++) {
        target = await findText(page, text, { exact, timeout: attempt ? 1200 : 2500 }).catch(() => undefined);
        if (!target && attempt < scrollSteps) await cursor.wheel(380, { steps: 10 });
      }
      if (!target) throw new Error(`Text not visible after scrolling: ${text}`);
      await cursor.hover(target, dwell);
    });
  }
}
