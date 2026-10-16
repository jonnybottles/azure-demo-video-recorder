import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { FPS, outDir, rawDir, readJson, scenarioDir, workDir, ensureDir, writeJson } from './paths.mjs';
import { ffmpeg, duration, X264 } from './ffmpeg.mjs';
import { renderCards } from './titles.mjs';
import { narrationFilter, scheduleNarration } from './voice.mjs';

const hash = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
const posix = (p) => p.replace(/\\/g, '/');

export function loadStoryboard(id) {
  const file = path.join(scenarioDir(id), 'storyboard.yaml');
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

// `takes` is the scenario whose raw takes are used: the storyboard's own id, or `takesFrom:` (a short cut re-uses the
// takes of a longer version, so nothing is recorded twice).
function shotMeta(takes, shotId) {
  const file = path.join(rawDir(takes), shotId, 'shot.json');
  if (!fs.existsSync(file)) throw new Error(`Shot "${shotId}" has not been recorded. Run: npm run record -- ${takes} --shot ${shotId}`);
  const meta = readJson(file);
  if (meta.failed) throw new Error(`Shot "${shotId}" failed while recording: ${meta.failed}`);
  if (!meta.frames.length) throw new Error(`Shot "${shotId}" has no frames.`);
  return meta;
}

function blurFilter(boxes) {
  // Fixed post-production blur boxes (fallback when on-page redaction cannot reach something).
  let chain = '';
  let label = 'base';
  boxes.forEach((b, i) => {
    const enable = b.from !== undefined || b.to !== undefined ? `:enable='between(t,${b.from ?? 0},${b.to ?? 99999})'` : '';
    chain += `;[${label}]split[m${i}][c${i}];[c${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},boxblur=22:3[b${i}];[m${i}][b${i}]overlay=${b.x}:${b.y}${enable}[o${i}]`;
    label = `o${i}`;
  });
  return { chain, label };
}

async function encodeShot(takes, shot, work) {
  const meta = shotMeta(takes, shot.id);
  const blur = shot.blur ?? [];
  const file = path.join(work, `shot-${shot.id}-${hash(meta.end, meta.frames.length, meta.frames.at(-1).t, blur)}.mp4`);
  if (fs.existsSync(file)) return { file, meta };
  const dir = path.join(rawDir(takes), shot.id);
  const frames = [...meta.frames].sort((a, b) => a.t - b.t);
  let list = 'ffconcat version 1.0\n';
  frames.forEach((f, i) => {
    const start = i === 0 ? 0 : f.t;
    const next = i + 1 < frames.length ? frames[i + 1].t : meta.end;
    list += `file '${posix(path.join(dir, f.file))}'\nduration ${Math.max(0.001, next - start).toFixed(4)}\n`;
  });
  list += `file '${posix(path.join(dir, frames.at(-1).file))}'\n`;
  const listFile = path.join(work, `shot-${shot.id}.ffconcat`);
  fs.writeFileSync(listFile, list);
  const { chain, label } = blurFilter(blur);
  const graph = `[0:v]fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[base]${chain}`;
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-filter_complex', graph, '-map', `[${label}]`, ...X264, `${file}.tmp.mp4`]);
  fs.renameSync(`${file}.tmp.mp4`, file);
  console.log(`  encoded shot ${shot.id} (${meta.end.toFixed(1)}s)`);
  return { file, meta };
}

async function cut(source, start, end, work, tag) {
  const file = path.join(work, `cut-${tag}-${hash(source, start, end)}.mp4`);
  if (!fs.existsSync(file)) {
    await ffmpeg(['-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', source, '-an', ...X264, `${file}.tmp.mp4`]);
    fs.renameSync(`${file}.tmp.mp4`, file);
  }
  return file;
}

// A frozen frame (the `holds:` key): the raw frame on screen at shot time t, held for `seconds`. Cached like cut().
async function still(takes, shot, meta, t, seconds, work) {
  const frame = [...meta.frames].sort((a, b) => a.t - b.t).filter((f) => f.t <= t).at(-1) ?? meta.frames[0];
  const source = path.join(rawDir(takes), shot.id, frame.file);
  // Only the blur boxes active at t apply, without their time window: the still's own clock starts at 0.
  const boxes = (shot.blur ?? []).filter((b) => (b.from ?? 0) <= t && t <= (b.to ?? 99999)).map(({ from, to, ...box }) => box);
  const file = path.join(work, `still-${shot.id}-${hash(source, frame.t, meta.end, seconds, boxes)}.mp4`);
  if (!fs.existsSync(file)) {
    const { chain, label } = blurFilter(boxes);
    const graph = `[0:v]scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[base]${chain}`;
    await ffmpeg(['-loop', '1', '-framerate', String(FPS), '-i', source, '-t', seconds.toFixed(3), '-filter_complex', graph, '-map', `[${label}]`, '-an', ...X264, `${file}.tmp.mp4`]);
    fs.renameSync(`${file}.tmp.mp4`, file);
  }
  return file;
}

// Splits a shot into kept ranges: trims, and removes every recorded wait (optionally replaced by a time-skip card).
function keepRanges(shot, meta) {
  const pad = shot.waitPad ?? 0.5;
  // trim, cut and hold values are seconds or the name of a recorded mark.
  const at = (v, fallback) => {
    if (v === undefined || v === null) return fallback;
    if (typeof v === 'number') return v;
    const mark = meta.marks.find((m) => m.name === v);
    if (!mark) throw new Error(`Mark "${v}" not found in shot "${shot.id}".`);
    return mark.t;
  };
  const [trimStart, trimEnd] = [at(shot.trim?.[0], 0), at(shot.trim?.[1], meta.end)];
  const parts = [];
  let cursor = trimStart;
  // Editorial cuts: `cuts: [[from, to], ...]` (seconds or mark names) remove dead time inside a shot, like a wait.
  const cuts = (shot.cuts ?? []).map(([a, b], i) => ({ name: `__cut${i}`, start: at(a, 0), end: at(b, meta.end) }));
  for (const w of [...meta.waits, ...cuts].sort((a, b) => a.start - b.start)) {
    const policy = shot.waits?.[w.name] ?? 'cut';
    const keep = typeof policy === 'object' && policy.keep !== undefined ? Number(policy.keep) : pad;
    if (policy === 'keep' || w.end - w.start < keep + pad + 0.5 || w.end <= trimStart || w.start >= trimEnd) continue;
    parts.push({ range: [cursor, Math.min(trimEnd, w.start + keep)] });
    // A time-skip card can carry its own spoken line (`narration:`) instead of its title.
    if (typeof policy === 'object' && policy.title) parts.push({ skip: { type: 'timeskip', title: policy.title, subtitle: policy.subtitle, seconds: policy.seconds, narration: policy.narration } });
    cursor = Math.max(trimStart, w.end - pad);
  }
  parts.push({ range: [cursor, trimEnd] });
  // `holds: [[at, seconds], ...]` (seconds or mark names) freeze the frame on screen at `at` for `seconds`, so a
  // spoken line has room at a moment that passes too quickly. The kept range around `at` is split in two.
  for (const [when, seconds] of shot.holds ?? []) {
    const t = at(when, 0);
    const i = parts.findIndex((p) => p.range && t >= p.range[0] && t <= p.range[1]);
    if (i < 0 || !(Number(seconds) > 0)) { console.warn(`  hold at ${t.toFixed(1)}s (${seconds}s) in "${shot.id}" is outside the kept footage or has no length; ignored`); continue; }
    const [a, b] = parts[i].range;
    parts.splice(i, 1, { range: [a, t] }, { still: { t, seconds: Number(seconds) } }, { range: [t, b] });
  }
  return parts.filter((p) => p.skip || p.still || p.range[1] - p.range[0] > 0.2);
}

function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function srtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

function captionFiles(captions, style) {
  const font = style?.font ?? 'Segoe UI Semibold';
  const size = style?.size ?? 40;
  let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Bottom,${font},${size},&H00FFFFFF,&H00FFFFFF,&HFF000000,&H0A201A14,0,0,0,0,100,100,0,0,4,24,0,2,280,280,64,1\n` +
    `Style: Top,${font},${size},&H00FFFFFF,&H00FFFFFF,&HFF000000,&H0A201A14,0,0,0,0,100,100,0,0,4,24,0,8,280,280,64,1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  let srt = '';
  captions.forEach((c, i) => {
    const text = c.text.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, '\\N');
    ass += `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${c.pos === 'top' ? 'Top' : 'Bottom'},,0,0,0,,{\\fad(250,250)}${text}\n`;
    srt += `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n\n`;
  });
  return { ass, srt };
}

// Outputs a build can write. Default: a clean render (for live talk-over) and a captioned render with the voice-over.
export const VERSIONS = ['clean', 'captions', 'voice', 'captions-voice'];
const DEFAULT_VERSIONS = ['clean', 'captions-voice'];

// `voice.pronounce: { WORD: "spoken form" }` fixes names the TTS voice gets wrong. Whole words, case-insensitive
// (WORD's becomes "spoken form's"); a key that matches the exact case wins over the others. On-screen text is unchanged.
export function speakable(text, pronounce) {
  const keys = Object.keys(pronounce ?? {});
  if (!keys.length) return text;
  const alternatives = [...keys].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<!\\w)(?:${alternatives.join('|')})(?!\\w)`, 'gi');
  return text.replace(pattern, (m) => pronounce[m] ?? pronounce[keys.find((k) => k.toLowerCase() === m.toLowerCase())]);
}

// What the voice says for a card: `narration:`, else the title of a section or time-skip card, emphasis asterisks
// removed. Shared by build and `lines`, so both hand the TTS cache the same text.
export function cardLine(card) {
  const line = card.narration ?? (['section', 'timeskip'].includes(card.type) ? card.title : undefined);
  return line === undefined || line === null ? undefined : String(line).replace(/\*/g, '');
}
// What the voice says for a caption: `say:`, else the caption text.
export const captionLine = (c) => c.say ?? c.text.trim();

// Every line the voice would speak, in storyboard order, from the storyboard alone (no takes): each scene card, then
// per shot its captions and its time-skip cards. `at` is the storyboard anchor, for printing.
export function spokenLines(board) {
  const rows = [];
  for (const scene of board.scenes) {
    const line = scene.card && cardLine(scene.card);
    if (line) rows.push({ shot: scene.id, at: 'card', text: line });
    for (const shot of scene.shots ?? []) {
      for (const c of (board.captions ?? []).filter((c) => c.shot === shot.id)) {
        const offset = c.offset ? `${c.offset > 0 ? '+' : ''}${c.offset}` : '';
        rows.push({ shot: shot.id, at: `${c.at ?? 'start'}${offset}`, text: captionLine(c) });
      }
      for (const [name, policy] of Object.entries(shot.waits ?? {})) {
        const skip = policy?.title && cardLine({ type: 'timeskip', ...policy });
        if (skip) rows.push({ shot: shot.id, at: `wait:${name}`, text: skip });
      }
    }
  }
  return rows;
}

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

export async function build(id, { only, partial = false, voice, plan = false } = {}) {
  const board = loadStoryboard(id);
  const takes = board.takesFrom ?? id;
  if (partial) {
    // Preview mode: drop shots (and their captions) that have not been recorded yet.
    const recorded = (shot) => fs.existsSync(path.join(rawDir(takes), shot.id, 'shot.json')) && !readJson(path.join(rawDir(takes), shot.id, 'shot.json')).failed;
    for (const scene of board.scenes) scene.shots = (scene.shots ?? []).filter(recorded);
    // A plan keeps every card (they need no takes), so card timing and narration are checked before all shots exist.
    board.scenes = board.scenes.filter((s) => s.shots.length || (plan ? s.card : ['intro', 'closing'].includes(s.card?.type)));
    const kept = new Set(board.scenes.flatMap((s) => s.shots.map((x) => x.id)));
    board.captions = (board.captions ?? []).filter((c) => kept.has(c.shot));
    board.output = `${board.output ?? id}-preview`;
  }
  const versions = board.versions ?? DEFAULT_VERSIONS;
  for (const v of versions) if (!VERSIONS.includes(v)) throw new Error(`Unknown version "${v}" in versions: use ${VERSIONS.join(', ')}.`);
  const voiced = Boolean(board.voice) && voice !== false;
  // Without a voice (none in the storyboard, or --no-voice), captions-voice falls back to a captions-only preview, so
  // caption timing can still be checked, and voice falls back to clean.
  const wanted = new Set(voiced ? versions : versions.map((v) => ({ 'captions-voice': 'captions', voice: 'clean' }[v] ?? v)));
  const built = VERSIONS.filter((v) => wanted.has(v));
  const work = ensureDir(workDir(id));
  // Encoded shots are cached next to the takes they come from, so a short cut re-uses the long version's encodes.
  const shotWork = ensureDir(workDir(takes));
  const out = ensureDir(outDir(id));
  const fades = { shot: board.transitions?.shot ?? 0.45, card: board.transitions?.card ?? 0.6, skip: board.transitions?.skip ?? 0.4, still: board.transitions?.still ?? 0.1 };

  // 1. Expand scenes into timeline items.
  const items = [];
  const shotsUsed = new Map();
  for (const scene of board.scenes) {
    let sceneStart = true;
    const push = (item) => {
      const prev = items.at(-1);
      let transition;
      if (!prev) transition = { type: null, d: 0 };
      else if (sceneStart) transition = { type: 'fadeblack', d: fades.card };
      else if (prev.card && prev.card.type !== 'timeskip') transition = { type: 'fade', d: fades.card };
      else if (item.card?.type === 'timeskip' || prev.card?.type === 'timeskip') transition = { type: 'fade', d: fades.skip };
      else if (item.still || prev.still) transition = { type: 'fade', d: fades.still };
      else transition = { type: item.shotTransition ?? 'fade', d: fades.shot };
      items.push({ ...item, scene: scene.id, transition });
      sceneStart = false;
    };
    if (scene.card) push({ card: scene.card });
    for (const shot of scene.shots ?? []) {
      const encoded = await encodeShot(takes, shot, shotWork);
      shotsUsed.set(shot.id, { shot, ...encoded });
      for (const part of keepRanges(shot, encoded.meta)) {
        if (part.skip) push({ card: part.skip });
        // A still carries a zero-length range at its time, so the caption lookup treats it as a clip of its shot.
        else if (part.still) push({ shotId: shot.id, still: part.still, range: [part.still.t, part.still.t] });
        else push({ shotId: shot.id, range: part.range, shotTransition: shot.transition });
      }
    }
  }

  // 2. Render cards and cut clips.
  const cardItems = items.filter((i) => i.card);
  const cardFiles = await renderCards(cardItems.map((i) => i.card));
  cardItems.forEach((item, i) => { item.file = cardFiles[i]; });
  for (const item of items.filter((i) => i.shotId)) {
    const used = shotsUsed.get(item.shotId);
    item.file = item.still
      ? await still(takes, used.shot, used.meta, item.still.t, item.still.seconds, work)
      : await cut(used.file, item.range[0], item.range[1], work, item.shotId);
  }
  for (const item of items) item.duration = await duration(item.file);

  // 3. Timeline with crossfades.
  let acc = 0;
  items.forEach((item, k) => {
    if (k === 0) { item.start = 0; item.transition = { type: null, d: 0 }; acc = item.duration; return; }
    const d = Math.min(item.transition.d, item.duration / 2, items[k - 1].duration / 2);
    item.transition.d = d;
    item.start = acc - d;
    acc = item.start + item.duration;
  });
  const total = acc;
  // `maxSeconds:` in the storyboard raises or lowers the length cap (default 600). A safety net, not a target.
  const maxSeconds = Number(board.maxSeconds ?? 600);
  if (total > maxSeconds) throw new Error(`Video would be ${total.toFixed(1)}s, over the ${maxSeconds}s limit. Trim the storyboard or raise maxSeconds.`);

  // 4. Captions mapped from shot time to final time.
  const captions = [];
  for (const c of board.captions ?? []) {
    const used = shotsUsed.get(c.shot);
    if (!used) throw new Error(`Caption references unknown shot "${c.shot}".`);
    let base = 0;
    if (c.at && c.at !== 'start') {
      const mark = used.meta.marks.find((m) => m.name === c.at);
      if (!mark) throw new Error(`Caption anchor "${c.at}" not found in shot "${c.shot}".`);
      base = mark.t;
    } else {
      const first = used.shot.trim?.[0];
      base = typeof first === 'string' ? (used.meta.marks.find((m) => m.name === first)?.t ?? 0) : (first ?? 0);
    }
    const t = base + (c.offset ?? 0);
    const clips = items.filter((i) => i.shotId === c.shot);
    const clip = clips.find((i) => t >= i.range[0] && t < i.range[1]) ?? clips.find((i) => i.range[0] >= t);
    if (!clip) throw new Error(`Caption "${c.text.slice(0, 40)}" falls outside the kept footage of "${c.shot}".`);
    const start = clip.start + Math.max(0, t - clip.range[0]) + (clip.range[0] > t ? clip.transition.d : 0);
    // Never shorter than a comfortable reading time (about 160 words per minute).
    const words = c.text.trim().split(/\s+/).length;
    const seconds = Math.max(Number(c.seconds ?? 5), words / 2.7 + 0.6);
    captions.push({ start, end: Math.min(total, start + seconds), text: c.text.trim(), pos: c.pos, say: c.say });
  }
  captions.sort((a, b) => a.start - b.start);
  for (let i = 1; i < captions.length; i++) {
    if (captions[i].start < captions[i - 1].end) captions[i - 1].end = Math.max(captions[i - 1].start + 1, captions[i].start - 0.05);
  }
  // Reading-time warnings matter only when captions are drawn (voice-only cues may follow each other freely).
  if (wanted.has('captions') || wanted.has('captions-voice')) {
    for (const c of captions) {
      const need = c.text.split(/\s+/).length / 2.7;
      if (c.end - c.start < need - 0.3) console.warn(`  short caption (${(c.end - c.start).toFixed(1)}s of ~${need.toFixed(1)}s): ${c.text.slice(0, 60)}`);
    }
  }

  // Scene boundaries (per-scene clips and the report).
  const scenes = [];
  board.scenes.forEach((scene, i) => {
    const sceneItems = items.filter((it) => it.scene === scene.id);
    if (!sceneItems.length) return;
    scenes.push({ id: scene.id, index: i + 1, start: sceneItems[0].start });
  });
  scenes.forEach((s, i) => { s.end = i + 1 < scenes.length ? scenes[i + 1].start + 0.3 : total; });

  // 5. Narration from the captions (and card lines), spoken as written unless voice.pronounce says otherwise.
  const name = board.output ?? id;
  let placed;
  let narration;
  if (voiced) {
    // pronounce changes the spoken text, not the voice: keep it out of the TTS settings (and the clip cache key).
    const { pronounce, ...ttsVoice } = board.voice;
    const say = (text) => speakable(text, pronounce);
    const cues = [];
    for (const item of items.filter((i) => i.card)) {
      const line = cardLine(item.card);
      if (line) cues.push({ at: item.start + item.transition.d + 0.2, text: say(line) });
    }
    for (const c of captions) cues.push({ at: c.start + 0.1, text: say(captionLine(c)) });
    placed = await scheduleNarration(cues, ttsVoice, total);
    narration = { voice: board.voice.name, lines: placed.length, maxLateSeconds: Number(Math.max(0, ...placed.map((p) => p.start - p.at)).toFixed(2)) };
    fs.writeFileSync(path.join(out, 'narration.txt'), placed.map((p) => `${p.start.toFixed(1).padStart(6)}s  ${p.text}`).join('\n') + '\n');
  }

  // --plan: timing, caption and voice warnings only (minutes instead of a full render). Fix warnings here, then build.
  if (plan) {
    console.log(`Plan for ${name}: ${clock(total)} (${total.toFixed(1)}s), ${captions.length} captions${placed ? `, ${placed.length} voice lines` : ''}`);
    for (const s of scenes) {
      console.log(`  ${s.id.padEnd(16)} starts ${clock(s.start).padStart(5)}  ${(s.end - s.start).toFixed(1).padStart(6)}s`);
      for (const shotId of new Set(items.filter((it) => it.scene === s.id && it.shotId).map((it) => it.shotId))) {
        const kept = items.filter((it) => it.shotId === shotId).reduce((sum, it) => sum + it.duration, 0);
        const holds = items.filter((it) => it.shotId === shotId && it.still).map((h) => `hold ${h.duration.toFixed(1)}s at ${h.still.t.toFixed(1)}s`);
        console.log(`    ${shotId.padEnd(18)} ${kept.toFixed(1).padStart(6)}s kept${holds.length ? ` (${holds.join(', ')})` : ''}`);
      }
    }
    return { totalSeconds: Number(total.toFixed(2)), plan: true };
  }

  // 6. Assemble the clean render (no captions, no voice). It is an output only when `clean` is a version.
  const file = (version) => path.join(wanted.has(version) ? out : work, `${name}-${version}.mp4`);
  const clean = file('clean');
  const inputs = items.flatMap((i) => ['-i', i.file]);
  let graph = items.map((_, k) => `[${k}:v]settb=AVTB,fps=${FPS},format=yuv420p,setpts=PTS-STARTPTS[s${k}]`).join(';');
  let last = 's0';
  items.forEach((item, k) => {
    if (k === 0) return;
    graph += `;[${last}][s${k}]xfade=transition=${item.transition.type}:duration=${item.transition.d.toFixed(3)}:offset=${item.start.toFixed(3)}[x${k}]`;
    last = `x${k}`;
  });
  graph += `;[${last}]fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8[final]`;
  const graphFile = path.join(work, 'assemble.filtergraph');
  fs.writeFileSync(graphFile, graph);
  // --only <version>: re-use an existing clean render instead of assembling it again.
  if (!(only && only !== 'clean' && fs.existsSync(clean))) {
    console.log(`  assembling ${items.length} segments (${total.toFixed(1)}s)`);
    await ffmpeg([...inputs, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-filter_complex_script', graphFile,
      '-map', '[final]', '-map', `${items.length}:a`, '-shortest', ...X264, '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', clean]);
  }

  // 7. Captioned render: an output when `captions` is a version, otherwise the base for captions-voice.
  const { ass, srt } = captionFiles(captions, board.captionStyle);
  fs.writeFileSync(path.join(out, 'captions.ass'), ass);
  fs.writeFileSync(path.join(out, 'captions.srt'), srt);
  const captioned = file('captions');
  if (wanted.has('captions') || wanted.has('captions-voice')) {
    const fontsDir = process.env.DEMO_FONTS_DIR ?? (process.platform === 'win32' ? 'C:/Windows/Fonts' : '');
    const escapedFontsDir = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\\\:').replace(/ /g, '\\ ');
    const assFilter = `ass=captions.ass${escapedFontsDir ? `:fontsdir=${escapedFontsDir}` : ''}`;
    await ffmpeg(['-i', clean, '-vf', assFilter, ...X264, '-c:a', 'copy', '-movflags', '+faststart', captioned], { cwd: out });
  }

  // 8. Voiced versions: the narration mixed under the captioned render (captions-voice) and/or the clean one (voice).
  if (placed) {
    const filterFile = path.join(work, 'voice.filtergraph');
    fs.writeFileSync(filterFile, narrationFilter(placed));
    const mix = (source, target) => ffmpeg(['-i', source, ...placed.flatMap((p) => ['-i', p.file]), '-filter_complex_script', filterFile,
      '-map', '0:v', '-map', '[voice]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', target]);
    if (wanted.has('voice')) await mix(clean, file('voice'));
    if (wanted.has('captions-voice')) await mix(captioned, file('captions-voice'));
  }

  // 9. Per-scene clips of every output, for editors such as Clipchamp.
  for (const version of built) {
    const dir = ensureDir(path.join(out, 'clips', version));
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
    const audio = version.includes('voice') ? '160k' : '64k';
    for (const s of scenes) {
      await ffmpeg(['-ss', s.start.toFixed(3), '-to', s.end.toFixed(3), '-i', file(version), ...X264, '-c:a', 'aac', '-b:a', audio,
        path.join(dir, `${String(s.index).padStart(2, '0')}-${s.id}.mp4`)]);
    }
  }

  const outputs = [...built.map((v) => path.basename(file(v))), 'captions.srt', ...built.map((v) => `clips/${v}/*`), ...(placed ? ['narration.txt'] : [])];
  const report = {
    builtAtUtc: new Date().toISOString(),
    totalSeconds: Number(total.toFixed(2)),
    scenes: scenes.map((s) => ({ id: s.id, start: Number(s.start.toFixed(2)), seconds: Number((s.end - s.start).toFixed(2)) })),
    captions: captions.length,
    narration,
    versions: built,
    outputs
  };
  writeJson(path.join(out, 'build-report.json'), report);
  console.log(`Built ${name}: ${Math.floor(total / 60)}m ${Math.round(total % 60)}s, ${scenes.length} scenes, ${captions.length} captions, ${built.join(' + ')} -> ${out}`);
  if (total > 420) console.warn('  note: longer than 7 minutes; the target is about 5.');
  return report;
}
