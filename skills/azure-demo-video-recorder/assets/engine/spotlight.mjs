// Spotlight: dims the page except one rectangle, with a numbered label, and glides between targets.
// Used to walk a diagram component by component. Works on any page (injected styles use the CSSOM, so CSP-safe).
export async function installSpotlight(page) {
  await page.evaluate(() => {
    if (document.getElementById('__spot')) return;
    const spot = document.createElement('div');
    spot.id = '__spot';
    Object.assign(spot.style, {
      position: 'fixed', left: '50%', top: '50%', width: '0px', height: '0px', borderRadius: '18px', zIndex: '2147483600',
      pointerEvents: 'none', border: '3px solid rgba(80,230,255,.95)', boxShadow: '0 0 0 9999px rgba(6,6,10,.62), 0 0 28px rgba(80,230,255,.45)',
      opacity: '0', transition: 'left .7s cubic-bezier(.3,.7,.2,1), top .7s cubic-bezier(.3,.7,.2,1), width .7s cubic-bezier(.3,.7,.2,1), height .7s cubic-bezier(.3,.7,.2,1), opacity .5s ease'
    });
    const label = document.createElement('div');
    label.id = '__spot_label';
    Object.assign(label.style, {
      position: 'fixed', zIndex: '2147483601', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: '12px',
      padding: '8px 18px 8px 8px', borderRadius: '999px', background: 'rgba(11,11,16,.92)', color: '#f4f4f7',
      font: '600 26px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif', border: '1px solid rgba(80,230,255,.45)',
      opacity: '0', transition: 'left .7s cubic-bezier(.3,.7,.2,1), top .7s cubic-bezier(.3,.7,.2,1), opacity .4s ease', whiteSpace: 'nowrap'
    });
    document.documentElement.append(spot, label);
  });
}

// Union of the bounding boxes of the given CSS selectors (or SVG <g> elements whose <title> matches), with padding.
export async function regionOf(page, { selectors = [], svgTitles = [], pad = 16 } = {}) {
  return page.evaluate(({ selectors, svgTitles, pad }) => {
    const els = [...selectors.flatMap((s) => [...document.querySelectorAll(s)])];
    for (const t of svgTitles) {
      const g = [...document.querySelectorAll('svg g')].find((x) => x.querySelector(':scope > title')?.textContent.trim() === t);
      if (g) els.push(g);
    }
    if (!els.length) return null;
    const r = els.map((e) => e.getBoundingClientRect()).reduce((a, b) => ({
      left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom)
    }));
    return { x: r.left - pad, y: r.top - pad, w: r.right - r.left + 2 * pad, h: r.bottom - r.top + 2 * pad };
  }, { selectors, svgTitles, pad });
}

export async function spotlight(page, rect, { label, step } = {}) {
  await page.evaluate(({ rect, label, step }) => {
    const spot = document.getElementById('__spot');
    const tag = document.getElementById('__spot_label');
    Object.assign(spot.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, opacity: '1' });
    if (label) {
      tag.replaceChildren();
      if (step !== undefined) {
        const n = document.createElement('span');
        n.textContent = String(step);
        Object.assign(n.style, { display: 'grid', placeItems: 'center', minWidth: '40px', height: '40px', borderRadius: '50%', background: 'rgba(80,230,255,.95)', color: '#06060a', fontWeight: '700' });
        tag.append(n);
      }
      tag.append(document.createTextNode(label));
      const above = rect.y > 90;
      Object.assign(tag.style, { left: `${Math.max(20, rect.x)}px`, top: `${above ? rect.y - 66 : rect.y + rect.h + 14}px`, opacity: '1' });
      // Keep the label on screen for targets near the right edge.
      const overflow = Math.max(20, rect.x) + tag.offsetWidth - (window.innerWidth - 20);
      if (overflow > 0) tag.style.left = `${Math.max(20, Math.max(20, rect.x) - overflow)}px`;
    } else tag.style.opacity = '0';
  }, { rect, label, step });
}

export async function clearSpotlight(page) {
  await page.evaluate(() => {
    for (const id of ['__spot', '__spot_label']) { const e = document.getElementById(id); if (e) e.style.opacity = '0'; }
  });
}
