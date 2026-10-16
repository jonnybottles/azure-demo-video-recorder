import { pause, sleep } from './paths.mjs';

// Injected into the top frame only. Renders above every element, including the Azure portal's iframes, and never
// receives pointer events. The recorder moves it explicitly, so it works where synthetic mouse events cannot be seen.
export const cursorInitScript = `(() => {
  if (window.top !== window || window.__demoCursor) return;
  const state = { x: -200, y: -200, el: null, hidden: false };
  const SVG = '<svg width="34" height="34" viewBox="0 0 34 34" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.38))">' +
    '<path d="M6 3 L6 27 L11.8 21.4 L15.7 30.4 L19.8 28.7 L15.9 19.8 L23.9 19.8 Z" fill="#ffffff" stroke="#111111" ' +
    'stroke-width="1.7" stroke-linejoin="round"/></svg>';
  function ensure() {
    if (state.el && state.el.isConnected) return;
    const host = document.documentElement;
    if (!host) return;
    const el = document.createElement('div');
    el.setAttribute('data-demo-cursor', '');
    el.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;' +
      'will-change:transform;transition:scale .08s ease;';
    el.innerHTML = SVG;
    host.appendChild(el);
    state.el = el;
    place();
  }
  function place() {
    if (!state.el) return;
    state.el.style.transform = 'translate(' + (state.x - 6) + 'px,' + (state.y - 3) + 'px)';
    state.el.style.display = state.hidden ? 'none' : '';
  }
  function ripple() {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:' + (state.x - 24) + 'px;top:' + (state.y - 24) + 'px;width:48px;height:48px;' +
      'border-radius:50%;border:3px solid rgba(80,230,255,.95);background:rgba(80,230,255,.22);z-index:2147483646;' +
      'pointer-events:none;transform:scale(.25);opacity:1;transition:transform .5s cubic-bezier(.2,.7,.3,1),opacity .6s ease;';
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(1.25)'; r.style.opacity = '0'; }));
    setTimeout(() => r.remove(), 800);
  }
  window.__demoCursor = {
    set(x, y) { ensure(); state.x = x; state.y = y; place(); },
    glide(x, y, ms) {
      ensure();
      return new Promise((resolve) => {
        const x0 = state.x, y0 = state.y;
        if (x0 < -100) { state.x = x; state.y = y; place(); resolve(); return; }
        const dx = x - x0, dy = y - y0, len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(70, len * 0.1) * (dx >= 0 ? 1 : -1);
        const cx = (x0 + x) / 2 - (dy / len) * bend, cy = (y0 + y) / 2 + (dx / len) * bend;
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          const u = 1 - e;
          state.x = u * u * x0 + 2 * u * e * cx + e * e * x;
          state.y = u * u * y0 + 2 * u * e * cy + e * e * y;
          place();
          if (t < 1) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
    },
    press(on) { ensure(); state.el.style.scale = on ? '0.86' : '1'; if (on) ripple(); },
    hide() { state.hidden = true; ensure(); place(); },
    show() { state.hidden = false; ensure(); place(); }
  };
  document.addEventListener('DOMContentLoaded', ensure);
  ensure();
})();`;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Cursor {
  constructor(page, start = { x: 1180, y: 640 }) {
    this.page = page;
    this.x = start.x;
    this.y = start.y;
  }

  async sync() {
    await this.page.evaluate(([x, y]) => window.__demoCursor?.set(x, y), [this.x, this.y]).catch(() => {});
  }

  async show(visible = true) {
    await this.page.evaluate((v) => (v ? window.__demoCursor?.show() : window.__demoCursor?.hide()), visible).catch(() => {});
  }

  async point(target, { fx = 0.5, fy = 0.5, timeout = 30000 } = {}) {
    if (typeof target.x === 'number') return target;
    await target.waitFor({ state: 'visible', timeout });
    const box = await target.boundingBox();
    if (!box) throw new Error('Target has no bounding box');
    return { x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) };
  }

  async moveTo(target, { ms, ...options } = {}) {
    const p = await this.point(target, options);
    const distance = Math.hypot(p.x - this.x, p.y - this.y);
    const duration = ms ?? clamp(360 + distance * 0.42, 420, 1150);
    await this.sync();
    await this.page.evaluate(([x, y, d]) => window.__demoCursor?.glide(x, y, d), [p.x, p.y, duration]).catch(() => {});
    this.x = p.x;
    this.y = p.y;
    await this.page.mouse.move(p.x, p.y);
  }

  async reveal(target, { margin = 140 } = {}) {
    if (typeof target.x === 'number') return;
    await target.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    // Visible by coordinates is not enough: rows in a scrolling grid can sit under a header or panel. Check what is
    // actually painted at the element's center (in its own frame) before deciding not to scroll.
    const hidden = await target.evaluate((el, m) => {
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 40), y = r.top + r.height / 2;
      if (y < 50 || y > innerHeight - m / 2 || x < 0 || x > innerWidth) return true;
      const hit = document.elementFromPoint(x, y);
      return !(hit && (hit === el || el.contains(hit) || hit.contains(el)));
    }, margin).catch(() => false);
    const box = await target.boundingBox().catch(() => null);
    if (!hidden && box && box.y > 60 && box.y + box.height < 1080 - margin / 2) return;
    await target.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
    await sleep(1000);
  }

  async hover(target, ms = 700, options = {}) {
    await this.reveal(target);
    await this.moveTo(target, options);
    await pause(ms);
  }

  async click(target, { before = 160, after = 450, ...options } = {}) {
    await this.reveal(target);
    await this.moveTo(target, options);
    await sleep(before);
    await this.page.evaluate(() => window.__demoCursor?.press(true)).catch(() => {});
    await this.page.mouse.down();
    await sleep(80);
    await this.page.mouse.up();
    await this.page.evaluate(() => window.__demoCursor?.press(false)).catch(() => {});
    await pause(after);
  }

  async type(target, text, { clear = true, delay = 50, ...options } = {}) {
    await this.click(target, { after: 150, ...options });
    if (clear) {
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.press('Backspace');
    }
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(delay * (0.55 + Math.random() * 0.9));
    }
    await sleep(250);
    await pause(150);
  }

  // Native <select> popups are separate OS widgets that a page capture never shows, so pick the value directly
  // after a visible click on the control.
  async select(target, value, options = {}) {
    await this.reveal(target);
    await this.moveTo(target, options);
    await sleep(140);
    await this.page.evaluate(() => { window.__demoCursor?.press(true); setTimeout(() => window.__demoCursor?.press(false), 90); }).catch(() => {});
    await target.selectOption(value);
    await pause(500);
  }

  async wheel(deltaY, { at, steps = 14, stepMs = 30 } = {}) {
    if (at) await this.moveTo(at);
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, deltaY / steps);
      await sleep(stepMs);
    }
    await sleep(350);
  }
}
