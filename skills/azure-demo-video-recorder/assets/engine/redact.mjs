import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL, REPO_ROOT, readJson, writeJson } from './paths.mjs';

const TERMS_FILE = path.join(LOCAL, 'redact.json');

// Patterns for identifiers that must never appear in a customer-facing recording. Resource names stay visible;
// anything that identifies the account, tenant, subscription or a reachable endpoint is blurred.
export const PATTERNS = [
  String.raw`[A-Za-z0-9._%+-]+@(?!example\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}`,
  String.raw`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`,
  String.raw`\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b`,
  String.raw`\b[a-z0-9-]+\.(?:scm\.)?(?:azurewebsites\.net|azure-api\.net|servicebus\.windows\.net|(?:blob|table|queue|file|dfs)\.core\.windows\.net|vault\.azure\.net|onmicrosoft\.com|logic\.azure\.com|eventgrid\.azure\.net|management\.azure-api\.net|developer\.azure-api\.net)\b`,
  // Foundry, Azure OpenAI and Cognitive Services endpoints (project endpoints, model inference URLs).
  String.raw`\b[a-z0-9-]+\.(?:services\.ai\.azure\.com|openai\.azure\.com|cognitiveservices\.azure\.com)\b`
];

function az(args) {
  try {
    return execFileSync('az', args, { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// Builds the local (ignored) term list from the signed-in Azure CLI context, plus optional extras in
// .local/video/redact-extra.json: { "terms": ["..."], "jsonFiles": ["relative/path.json"] } (every string value of 6+
// characters in those JSON files is treated as sensitive). Never written into the repository.
export function prepareTerms() {
  const terms = new Set();
  const account = JSON.parse(az(['account', 'show', '-o', 'json']) || '{}');
  for (const value of [account.user?.name, account.name, account.id, account.tenantId, account.tenantDisplayName,
    account.tenantDefaultDomain, account.homeTenantId]) {
    if (value) terms.add(String(value));
  }
  const displayName = az(['ad', 'signed-in-user', 'show', '--query', 'displayName', '-o', 'tsv']);
  if (displayName) terms.add(displayName);
  const extra = readJson(path.join(LOCAL, 'redact-extra.json'), {});
  for (const term of extra.terms ?? []) terms.add(String(term));
  for (const relative of extra.jsonFiles ?? []) {
    const file = path.resolve(REPO_ROOT, relative);
    if (!fs.existsSync(file)) continue;
    const walk = (value) => {
      if (typeof value === 'string') {
        if (value.length >= 6 && !value.startsWith('api://') && !/^https?:/.test(value)) terms.add(value.replace(/\/32$/, ''));
      } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(readJson(file));
  }
  const list = [...terms].filter((t) => t.length >= 4);
  writeJson(TERMS_FILE, { terms: list, createdAtUtc: new Date().toISOString() });
  return list;
}

export function loadTerms() {
  if (!fs.existsSync(TERMS_FILE)) return prepareTerms();
  return readJson(TERMS_FILE).terms;
}

// Runs in every frame (including cross-origin portal iframes). Marks elements that contain sensitive text before
// they are painted: the MutationObserver callback runs as a microtask, ahead of the next rendering step.
export function redactionInitScript(terms) {
  return `(() => {
  if (window.__demoRedact) return;
  window.__demoRedact = true;
  const TERMS = ${JSON.stringify(terms.map((t) => t.toLowerCase()))};
  const PATTERNS = ${JSON.stringify(PATTERNS)}.map((p) => new RegExp(p, 'i'));
  const MARK = 'data-demo-redact';
  const sensitive = (s) => {
    if (!s || s.length < 4) return false;
    const l = s.toLowerCase();
    for (const t of TERMS) if (l.includes(t)) return true;
    for (const p of PATTERNS) if (p.test(s)) return true;
    return false;
  };
  function style() {
    const root = document.head || document.documentElement;
    if (!root || document.getElementById('__demo_redact_style')) return;
    const s = document.createElement('style');
    s.id = '__demo_redact_style';
    s.textContent = '[' + MARK + ']{filter:blur(9px) !important;}';
    root.appendChild(s);
  }
  function mark(el, textNode) {
    if (!el || el.nodeType !== 1 || el.hasAttribute(MARK)) return;
    if (el === document.body || el === document.documentElement) {
      if (textNode && textNode.parentNode) {
        const span = document.createElement('span');
        span.setAttribute(MARK, '');
        span.style.setProperty('filter', 'blur(9px)', 'important');
        textNode.parentNode.insertBefore(span, textNode);
        span.appendChild(textNode);
      }
      return;
    }
    el.setAttribute(MARK, '');
    // Set through the CSSOM as well: pages with a strict Content Security Policy block injected stylesheets.
    el.style.setProperty('filter', 'blur(9px)', 'important');
    if (getComputedStyle(el).display === 'inline') el.style.setProperty('display', 'inline-block', 'important');
  }
  const checkText = (n) => { if (sensitive(n.nodeValue)) mark(n.parentElement, n); };
  // An address typed into a field matches the e-mail pattern only once it is complete, so the local part would be
  // readable while typing. E-mail and user-name fields (and any value with an @) are blurred from the first keystroke.
  const ADDRESS_FIELD = /e-?mail|user-?name|login/i;
  const addressField = (el) => el.type === 'email' || ADDRESS_FIELD.test([el.name, el.id, el.autocomplete].join(' '));
  const checkInput = (el) => {
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    const value = el.value || '';
    if ((value && addressField(el)) || value.includes('@') || sensitive(value) || sensitive(el.placeholder)) mark(el);
  };
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { checkText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) checkText(n);
    if (root.nodeType === 1) checkInput(root);
    if (root.querySelectorAll) root.querySelectorAll('input,textarea').forEach(checkInput);
  }
  const observer = new MutationObserver((mutations) => {
    style();
    for (const m of mutations) {
      if (m.type === 'characterData') checkText(m.target);
      else if (m.type === 'attributes') { if (m.target.nodeType === 1) checkInput(m.target); }
      else m.addedNodes.forEach(scan);
    }
  });
  function start() {
    style();
    scan(document);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });
  }
  document.addEventListener('input', (e) => e.target && checkInput(e.target), true);
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  setInterval(() => { style(); document.querySelectorAll('input,textarea').forEach(checkInput); }, 400);
})();`;
}
