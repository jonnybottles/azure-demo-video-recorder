// Helpers for recorders that walk a real person's journey through a live app: sign-up e-mails, an authenticator app,
// idle sign-out, small UI text. Import what a recorder needs; none of this runs unless called.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---- Authenticator (TOTP) codes ---------------------------------------------------------------------------------
// The recording PC's clock can be minutes off, and a code from a skewed clock is simply "invalid". Take the time
// from the app's own server (HTTP Date header, median of three) before generating codes.
let clockOffset = 0;
export async function syncClock(url) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    const t1 = Date.now();
    samples.push(Date.parse(res.headers.get('date')) + 500 - (t0 + t1) / 2);
  }
  clockOffset = samples.sort((a, b) => a - b)[1];
  return clockOffset;
}
export const serverNow = () => Date.now() + clockOffset;

// RFC 6238 (SHA-1, 6 digits, 30 s): what Microsoft, Google and FreeOTP authenticators use by default.
export function totp(secretB32, t = serverNow()) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretB32.replace(/[\s=]/g, '').toUpperCase()) bits += alpha.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / 30)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
// A code with at least 8 s of life left, so it never expires between typing and submitting.
export async function freshCode(secret) {
  const left = 30 - (Math.floor(serverNow() / 1000) % 30);
  if (left < 8) await new Promise((r) => setTimeout(r, (left + 1) * 1000));
  return totp(secret, serverNow());
}
// The enrolment QR code's otpauth:// secret, read from its data URL without showing it (needs jsqr + pngjs).
export async function secretFromQr(dataUrl) {
  const [{ default: jsQR }, { PNG }] = await Promise.all([import('jsqr'), import('pngjs')]);
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!qr) throw new Error('Could not read the authenticator QR code');
  const secret = new URL(qr.data).searchParams.get('secret');
  if (!secret) throw new Error('The authenticator QR code has no secret');
  return secret;
}

// ---- Demo-account secrets (outside the repository, never printed) ------------------------------------------------
export function secretsFile(file) {
  return {
    read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } },
    write(patch) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...this.read(), ...patch }, null, 1), { mode: 0o600 });
    }
  };
}
export function newPassword(length = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.';
  return Array.from(crypto.randomBytes(length), (b) => alphabet[b % alphabet.length]).join('');
}

// ---- Pacing a take to the script -------------------------------------------------------------------------------
// Narration-first: every mark's segment must last at least as long as the line spoken there. `lines` holds the
// seconds of speech per shot and mark, copied from `npm run lines -- <scenario>`:
//   const pace = paceToScript({ 'deploy-form': { form: 13.0, size: 12.4 } });
//   const mark = pace.marker(s, 'deploy-form');   // inside recorder.shot(page, 'deploy-form', async (s) => { ... })
//   mark('form'); await cursor.hover(...); await pace.fill();
// fill() waits until the line at the last mark plus `margin` seconds has passed since that mark; hovers and typing in
// between count towards it, so the take fits the voice whatever DEMO_PACE is. A mark with no line returns at once.
export function paceToScript(lines, { margin = 1.2 } = {}) {
  let last = { shot: '', name: '', at: 0 };
  return {
    marker(s, shot) {
      return (name) => { s.mark(name); last = { shot, name, at: Date.now() }; };
    },
    async fill(seconds = lines[last.shot]?.[last.name]) {
      if (!seconds) return;
      const left = last.at + (seconds + margin) * 1000 - Date.now();
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    }
  };
}

// ---- Idle sign-out ---------------------------------------------------------------------------------------------
// Apps with an inactivity sign-out (often 15 minutes) log the recording browser out during long waits. A one-pixel
// move of the real mouse once a minute counts as activity; the drawn cursor does not move.
export async function awake(page, promise, everyMs = 60_000) {
  let n = 0;
  const timer = setInterval(() => { n++; page.mouse.move(5 + (n % 2), 5).catch(() => {}); }, everyMs);
  try { return await promise; } finally { clearInterval(timer); }
}

// ---- E-mailed links (Gmail, Outlook web) ------------------------------------------------------------------------
// Mail clients open links in a new tab, and confirmation links usually work once. Read the target instead and
// swallow the click (the cursor still visibly clicks), then open it in the recorder's own page inside the next shot.
export async function linkTarget(link) {
  const href = await link.evaluate((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
    return a.href;
  });
  const u = new URL(href);
  return u.hostname.endsWith('google.com') && u.searchParams.get('q') ? u.searchParams.get('q') : href;
}

// ---- Readability -----------------------------------------------------------------------------------------------
// Laptop-sized UIs are small at 1080p. Zoom the page body (never the document element: the recorder's cursor overlay
// lives there) for the given hosts only. Usage: await context.addInitScript(zoomInitScript(['app.example.com'], 1.25)).
export function zoomInitScript(hostSuffixes, zoom = 1.25) {
  return { content: `(() => {
    const hosts = ${JSON.stringify(hostSuffixes)};
    if (window.top !== window || !hosts.some((h) => location.hostname === h || location.hostname.endsWith('.' + h))) return;
    const apply = () => { if (!document.body) return requestAnimationFrame(apply); document.body.style.zoom = '${zoom}'; };
    apply();
    document.addEventListener('DOMContentLoaded', apply);
  })();` };
}
// Blur selectors from the first painted frame (QR codes, one-time keys) on matching hosts.
export function blurInitScript(hostSuffixes, selectors) {
  return { content: `(() => {
    const hosts = ${JSON.stringify(hostSuffixes)};
    if (!hosts.some((h) => location.hostname === h || location.hostname.endsWith('.' + h))) return;
    const add = () => {
      const root = document.head || document.documentElement;
      if (!root) return requestAnimationFrame(add);
      const s = document.createElement('style');
      s.textContent = ${JSON.stringify(`${selectors.join(',')}{filter:blur(16px)!important}`)};
      root.appendChild(s);
    };
    add();
  })();` };
}

// ---- Off-camera inspection -------------------------------------------------------------------------------------
// A shot that records nothing: saves each route's visible text and a screenshot, so selectors and captions are
// written against the live page instead of guessed. DEMO_INSPECT=/a,/b npm run record -- <scenario> --shot inspect
// (Git Bash rewrites a leading "/" into a Windows path: prefix the command with MSYS_NO_PATHCONV=1.)
export function inspectShot({ open, wait = Number(process.env.DEMO_INSPECT_WAIT ?? 3000) }) {
  return {
    id: 'inspect',
    async run(ctx) {
      const routes = (process.env.DEMO_INSPECT ?? '').split(',').filter(Boolean);
      if (!routes.length) return;
      const page = await ctx.page('inspect');
      const dir = path.join(ctx.recorder.dir, '..', 'inspect');
      fs.mkdirSync(dir, { recursive: true });
      for (const route of routes) {
        await open(ctx, page, route);
        await page.waitForTimeout(wait);
        const name = route.replace(/[^a-z0-9]+/gi, '_');
        fs.writeFileSync(path.join(dir, `${name}.txt`), await page.locator('body').innerText());
        await page.screenshot({ path: path.join(dir, `${name}.jpg`), quality: 70 });
        console.log(`  inspected ${route}`);
      }
    }
  };
}
