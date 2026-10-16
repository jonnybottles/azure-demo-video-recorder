import fs from 'node:fs';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { LOCAL, VIDEO_ROOT, ensureDir, outDir, readJson, writeJson } from './paths.mjs';
import { ffmpeg } from './ffmpeg.mjs';
import { PATTERNS, loadTerms } from './redact.mjs';
import { loadStoryboard } from './builder.mjs';

const CODE_SIGNS = [/\bfunction\s*\(/, /=>\s*\{/, /\bpublic\s+(static|async|sealed)\b/, /\busing\s+System/, /\bdotnet\s+run\b/,
  /\bPS [A-Z]:\\/, /"definition"\s*:/, /\$schema/, /<soap:Envelope/i, /\bconst\s+\w+\s*=/];

export function normalizeExampleDomain(text) {
  return text.replace(/examp[l1I|]e\.c[o0][a-z|]{0,2}(?![a-z0-9])/gi, 'example.com');
}

// The rendered versions to check: the .mp4 outputs listed in build-report.json (clean, captions-voice, ...).
function builtVersions(id, name) {
  const report = readJson(path.join(outDir(id), 'build-report.json'), {});
  const versions = (report.outputs ?? []).filter((o) => o.endsWith('.mp4') && o.startsWith(`${name}-`)).map((o) => o.slice(name.length + 1, -4));
  if (!versions.length) throw new Error(`No rendered ${name} video in ${path.join(outDir(id), 'build-report.json')}. Run: npm run build -- ${id}`);
  return versions;
}

// OCR every rendered version to catch unblurred identifiers and code-like screens; also writes contact sheets for review.
export async function qa(id, { every = 1, partial = false } = {}) {
  const board = loadStoryboard(id);
  const name = `${board.output ?? id}${partial ? '-preview' : ''}`;
  const versions = builtVersions(id, name);
  const dir = ensureDir(path.join(LOCAL, id, 'qa'));
  const terms = loadTerms().map((t) => t.toLowerCase());
  const patterns = PATTERNS.map((p) => new RegExp(p, 'i'));
  const findings = [];
  const tessdataCache = ensureDir(path.join(LOCAL, 'tesseract'));
  const worker = await createWorker('eng', 1, { cachePath: tessdataCache });
  try {
    for (const variant of versions) {
      const video = path.join(outDir(id), `${name}-${variant}.mp4`);
      const frames = ensureDir(path.join(dir, variant));
      for (const f of fs.readdirSync(frames)) fs.rmSync(path.join(frames, f));
      await ffmpeg(['-i', video, '-vf', `fps=1/${every}`, path.join(frames, 'f%05d.png')]);
      const text = {};
      for (const file of fs.readdirSync(frames).filter((f) => f.endsWith('.png')).sort()) {
        const { data } = await worker.recognize(path.join(frames, file));
        text[file] = data.text;
      }
      const ocrFile = path.join(dir, `${variant}-ocr.json`);
      writeJson(ocrFile, text);
      for (const [file, content] of Object.entries(text)) {
        const t = (Number(file.match(/\d+/)[0]) - 1) * every;
        const flat = normalizeExampleDomain(String(content ?? ''));
        const squashed = flat.toLowerCase().replace(/\s+/g, '');
        for (const term of terms) if (squashed.includes(term.replace(/\s+/g, ''))) findings.push({ variant, t, kind: 'term', match: '[redacted term]' });
        for (const p of patterns) { const m = flat.match(p); if (m) findings.push({ variant, t, kind: 'pattern', match: m[0] }); }
        for (const p of CODE_SIGNS) { const m = flat.match(p); if (m) findings.push({ variant, t, kind: 'code', match: m[0] }); }
      }
      await ffmpeg(['-i', video, '-vf', 'fps=1/6,scale=480:-1,tile=4x4:padding=6:color=white', path.join(dir, `${variant}-sheet-%02d.png`)]);
    }
  } finally {
    await worker.terminate();
  }
  writeJson(path.join(dir, 'qa-report.json'), { checkedAtUtc: new Date().toISOString(), every, findings });
  if (findings.length) {
    console.log(`QA found ${findings.length} item(s):`);
    for (const f of findings) console.log(`  ${f.variant} @ ${f.t}s ${f.kind}: ${f.match}`);
  } else {
    console.log(`QA passed: no identifiers or code detected by OCR in ${versions.join(' or ')}.`);
  }
  console.log(`Contact sheets and OCR output: ${dir}`);
  return findings;
}
