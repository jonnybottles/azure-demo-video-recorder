import { chromium } from 'playwright';
import { cursorInitScript } from './cursor.mjs';
import { loadTerms, redactionInitScript } from './redact.mjs';
import { PROFILE, VIEWPORT, ensureDir } from './paths.mjs';

export function browserLaunchOptions({ headless = true } = {}) {
  const browser = (process.env.DEMO_BROWSER ?? 'chromium').toLowerCase();
  const channels = { chromium: undefined, chrome: 'chrome', msedge: 'msedge' };
  if (!(browser in channels)) throw new Error('DEMO_BROWSER must be chromium, chrome, or msedge.');
  return {
    ...(channels[browser] ? { channel: channels[browser] } : {}),
    headless,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-default-browser-check']
  };
}

// The isolated profile holds the owner's Azure portal sign-in. Recordings never handle credentials.
export async function launch({ headless = true, ephemeral = false } = {}) {
  ensureDir(PROFILE);
  const options = {
    ...browserLaunchOptions({ headless }),
    headless,
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'en-US',
    colorScheme: 'light',
    // Some demo consoles use a strict CSP; overlays still need to apply inside them.
    bypassCSP: true
  };
  let context;
  if (ephemeral) {
    const browser = await chromium.launch(browserLaunchOptions({ headless }));
    context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light', bypassCSP: true });
    context.on('close', () => browser.close().catch(() => {}));
  } else {
    context = await chromium.launchPersistentContext(PROFILE, options);
  }
  await context.addInitScript({ content: redactionInitScript(loadTerms()) });
  await context.addInitScript({ content: cursorInitScript });
  return context;
}

export async function newPage(context) {
  const blank = context.pages().find((p) => p.url() === 'about:blank');
  return blank ?? context.newPage();
}
