import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { LOCAL, ensureDir, readJson, writeJson } from './paths.mjs';
import { duration, ffmpeg, run } from './ffmpeg.mjs';

const exec = promisify(execFile);
const CONFIG = path.join(LOCAL, 'voice.json');
const ELEVEN = 'https://api.elevenlabs.io/v1';
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let cachedAzureToken;
async function getAzureToken() {
  if (cachedAzureToken && cachedAzureToken.expires > Date.now() + 60000) return cachedAzureToken.value;
  const { stdout } = await exec('az', ['account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com', '-o', 'json'],
    { shell: process.platform === 'win32' });
  const parsed = JSON.parse(stdout);
  cachedAzureToken = {
    value: parsed.accessToken,
    expires: Date.parse(parsed.expiresOn ?? parsed.expires_on) || Date.now() + 30 * 60000
  };
  return cachedAzureToken.value;
}

async function elevenLabsKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Set ELEVENLABS_API_KEY in your environment; never put API keys in the storyboard or repository.');
  return key;
}

async function elevenVoiceId(voice) {
  if (voice.voiceId) return voice.voiceId;
  const cacheFile = path.join(LOCAL, 'elevenlabs-voices.json');
  const cache = readJson(cacheFile, {});
  if (cache[voice.name]) return cache[voice.name];
  const response = await fetch(`${ELEVEN}/voices`, { headers: { 'xi-api-key': await elevenLabsKey() } });
  if (!response.ok) throw new Error(`ElevenLabs voice lookup failed (${response.status}); check the API key and Voices: Read permission.`);
  const { voices } = await response.json();
  const wanted = String(voice.name ?? '').toLowerCase();
  const match = voices.find((v) => v.name.toLowerCase() === wanted);
  if (!match) throw new Error(`Voice "${voice.name}" was not found in the account. Add the voice or set voiceId explicitly.`);
  cache[voice.name] = match.voice_id;
  writeJson(cacheFile, cache);
  return match.voice_id;
}

async function elevenLabs(text, voice, file) {
  const id = await elevenVoiceId(voice);
  const model = voice.model ?? 'eleven_multilingual_v2';
  const dialogue = /^eleven_v[34]/.test(model);
  const url = dialogue ? `${ELEVEN}/text-to-dialogue?output_format=mp3_44100_128`
    : `${ELEVEN}/text-to-speech/${id}?output_format=mp3_44100_128`;
  const body = dialogue
    ? { inputs: [{ text, voice_id: id }], model_id: model, settings: { stability: voice.stability ?? 0.5 }, ...(voice.seed !== undefined ? { seed: voice.seed } : {}) }
    : { text, model_id: model, voice_settings: { stability: voice.stability ?? 0.5, similarity_boost: voice.similarity ?? 0.75, style: voice.style ?? 0, use_speaker_boost: true, speed: voice.speed ?? 1 } };
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': await elevenLabsKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body)
    });
    if (response.ok) return normalizeMp3(response, file);
    const message = await response.text().catch(() => '');
    if (attempt < 4 && [429, 500, 502, 503].includes(response.status)) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    throw new Error(`ElevenLabs synthesis failed (${response.status}): ${message.slice(0, 500)}`);
  }
}

async function openAiSpeech(text, voice, file) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Set OPENAI_API_KEY in your environment; never put API keys in the storyboard or repository.');
  const response = await fetch(process.env.OPENAI_TTS_ENDPOINT ?? 'https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      model: voice.model ?? 'gpt-4o-mini-tts',
      voice: voice.voice ?? 'marin',
      input: text,
      ...(voice.instructions ? { instructions: voice.instructions } : {}),
      response_format: 'mp3'
    })
  });
  if (!response.ok) throw new Error(`OpenAI speech synthesis failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return normalizeMp3(response, file);
}

async function normalizeMp3(response, file) {
  const mp3 = `${file}.mp3`;
  try {
    fs.writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
    await ffmpeg(['-i', mp3, '-ar', '48000', '-ac', '1', file]);
  } finally {
    fs.rmSync(mp3, { force: true });
  }
}

async function azureSpeech(text, voice, file, config) {
  const ssml = `<speak version="1.0" xml:lang="${voice.language ?? 'en-US'}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice.name}">` +
    `<prosody rate="${voice.rate ?? '0%'}">${escapeXml(text)}</prosody></voice></speak>`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${config.endpoint.replace(/\/$/, '')}/tts/cognitiveservices/v1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getAzureToken()}`, 'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm', 'User-Agent': 'azure-demo-video-recorder' },
      body: ssml
    });
    if (response.ok) { fs.writeFileSync(file, Buffer.from(await response.arrayBuffer())); return; }
    if (attempt >= 4 || ![429, 500, 502, 503].includes(response.status)) {
      throw new Error(`Azure AI Speech synthesis failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

async function systemSpeech(text, file) {
  if (process.platform === 'darwin') {
    const aiff = `${file}.aiff`;
    try { await run('say', ['-o', aiff, text]); await ffmpeg(['-i', aiff, '-ar', '48000', '-ac', '1', file]); }
    finally { fs.rmSync(aiff, { force: true }); }
    return;
  }
  if (process.platform === 'linux') {
    const executable = process.env.DEMO_ESPEAK ?? 'espeak-ng';
    await run(executable, ['-w', file, text]);
    return;
  }
  const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$s.Rate = 0; $s.SetOutputToWaveFile('${file.replace(/'/g, "''")}'); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
  const shell = process.env.DEMO_POWERSHELL ?? 'powershell.exe';
  await run(shell, ['-NoProfile', '-Command', script], { input: (stdin) => { stdin.write(text); stdin.end(); } });
}

async function synthesize(text, voice, file) {
  if (voice.provider === 'elevenlabs') return elevenLabs(text, voice, file);
  if (voice.provider === 'openai') return openAiSpeech(text, voice, file);
  const config = readJson(CONFIG, {});
  if (voice.provider === 'azure' || (!voice.provider && config.endpoint)) {
    if (!config.endpoint) throw new Error('Azure AI Speech requires .local/video/voice.json with an endpoint.');
    return azureSpeech(text, voice, file, config);
  }
  return systemSpeech(text, file);
}

export async function narrationClip(text, voice) {
  const dir = ensureDir(path.join(LOCAL, 'tts'));
  const config = readJson(CONFIG, {});
  const engine = voice.provider ?? (config.endpoint ? 'azure' : 'system');
  const key = crypto.createHash('sha256').update(JSON.stringify([engine, voice, text])).digest('hex').slice(0, 16);
  const file = path.join(dir, `${key}.wav`);
  if (!fs.existsSync(file)) await synthesize(text, voice, `${file}.tmp.wav`).then(() => fs.renameSync(`${file}.tmp.wav`, file));
  return { file, seconds: await duration(file) };
}

export async function scheduleNarration(cues, voice, total) {
  const placed = [];
  let free = 0;
  for (const cue of [...cues].sort((a, b) => a.at - b.at)) {
    const clip = await narrationClip(cue.text, voice);
    const start = Math.max(cue.at, free + 0.25);
    if (start - cue.at > 1.5) console.warn(`  voice runs ${(start - cue.at).toFixed(1)}s late: ${cue.text.slice(0, 60)}`);
    if (start + clip.seconds > total - 2) console.warn(`  voice runs past the end (needs 2 s of air before the end): ${cue.text.slice(0, 60)}`);
    placed.push({ ...cue, start, file: clip.file, seconds: clip.seconds });
    free = start + clip.seconds;
  }
  return placed;
}

export function narrationFilter(placed) {
  const parts = placed.map((p, i) => `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=mono,adelay=${Math.round(p.start * 1000)}:all=1[v${i}]`);
  return `${parts.join(';')};${placed.map((_, i) => `[v${i}]`).join('')}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo[voice]`;
}
