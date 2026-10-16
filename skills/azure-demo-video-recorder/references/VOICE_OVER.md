# AI voice-over

Choose a provider in the storyboard. Provider credentials are read from environment variables; never store keys in
`storyboard.yaml`, source files or version control.

## Azure AI Speech

Configure `.local/video/voice.json` (ignored):

```json
{ "endpoint": "https://<speech-resource>.cognitiveservices.azure.com" }
```

Set `voice: { provider: azure, name: en-US-AvaMultilingualNeural }`. The engine gets an Entra token using
`az account get-access-token`; the signed-in identity must already have a speech data-plane role. Do not create
resources, read keys or assign access as part of video recording.

## ElevenLabs

1. The user creates an API key in their normal browser and grants only the permissions needed for TTS and voice
   lookup (Text to Speech access and Voices read, if resolving by name).
2. Set `ELEVENLABS_API_KEY` in the local process environment. The key is never logged or written by the engine.
3. Use a storyboard entry such as:

   ```yaml
   voice:
     provider: elevenlabs
     name: "Voice name in the account"
     model: eleven_multilingual_v2
   ```

Set `voiceId` directly to skip the voice lookup. `eleven_v3` and `eleven_v4` use the Text to Dialogue endpoint; other
supported TTS model IDs use Text to Speech. Add `seed` when supported and repeatable output is useful.

**Voice Library voices**: lookup by `name` only searches the
account's own voices, so use `voiceId` (it is honored first). Find the ID with
`GET /v1/shared-voices?search=<name>` (`voice_id` in the result). Using a library voice over the API needs a paid
plan (Starter or above); if synthesis returns 402/403, add it to My Voices once
(`POST /v1/voices/add/{public_owner_id}/{voice_id}` with `{ "new_name": "..." }`) or pick another voice. Keep `name`
in the storyboard for readability; the engine ignores it when `voiceId` is set.

```yaml
voice: { provider: elevenlabs, name: "Library voice", voiceId: "<public-voice-id>", model: eleven_multilingual_v2 }
```

On Windows, a key saved as a User environment variable is not visible to shells that were already open. Load it into
the build's process only: `$env:ELEVENLABS_API_KEY = [Environment]::GetEnvironmentVariable('ELEVENLABS_API_KEY','User')`.

## OpenAI

Set `OPENAI_API_KEY` in the local process environment and choose a built-in voice:

```yaml
voice:
  provider: openai
  model: gpt-4o-mini-tts
  voice: marin
  instructions: "Warm, clear, professional narration."
```

The engine calls the Audio speech endpoint and converts the MP3 response to a 48 kHz mono WAV clip. Model and voice
availability can change; check the current [speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
before a new project.

## System voice

Set `voice: { provider: system }` or omit `voice` to use the local operating-system speech tool:

- Windows: PowerShell `System.Speech`
- macOS: `say`
- Linux: `espeak-ng` (override with `DEMO_ESPEAK`)

System voices are useful for previews but may sound synthetic. Listen to a sample before building the full narration.

## Names the voice gets wrong

TTS voices often mangle product names, especially ones written in capitals (an all-caps name is read as one odd word
or spelled out). Fix it once for the whole video with `pronounce:` in the voice entry; on-screen text stays as written:

```yaml
voice: { provider: elevenlabs, name: "Library voice", voiceId: "<public-voice-id>", model: eleven_multilingual_v2,
         pronounce: { ACMECLOUD: "Acme Cloud", acmecloud: "acme cloud" } }
```

Matches are whole words and case-insensitive (`ACMECLOUD's` becomes `Acme Cloud's`); a key with the exact case wins,
so a lower-case command name can get its own reading. It applies to every spoken line: card `narration`, section and
time-skip titles, caption `say:`, and caption text without `say:`. `narration.txt` holds the text as spoken; check it
with a search for the original spelling, which must find nothing. `pronounce` is not part of the voice settings, so
lines without the name keep their cached clips.

The same trick fixes ordinary words the voice misreads. "README" came out as "red me"; "read me" is ambiguous to the
voice too, so spell it the way it sounds: `README: "reed me"`. `narration.txt` then shows "reed me", which is fine (it
is the spoken text, not the screen). Keys match whole words, so "README.md" is read "reed me dot md"; say "the README
file" instead. Confirm with a search of `narration.txt` for the phonetic spelling.

## Timing and output

- Every caption (or its `say:` text) is spoken, starting shortly after it appears.
- Section and time-skip card titles are spoken; other cards use their `narration:` line.
- Overlapping lines wait for the previous one; the build warns when a line is late or reaches the end.
- To fix late opening cards, measure cached clip durations and set the card's `seconds` to voice length plus about 1.3 s.
- The mix is loudness-normalized and laid under the captioned render as `<Name>-captions-voice.mp4` (and under the
  clean render as `<Name>-voice.mp4` when `versions:` asks for `voice`).
- Speech clips are cached under `.local/video/tts`, keyed by the voice settings and the spoken text; changing a line
  or voice creates a new cache entry, and a short cut that keeps a caption word for word reuses its clip.

## Troubleshooting

| Error | Check |
| --- | --- |
| 401/403 | API key, endpoint, permissions or Azure role |
| 402 | Provider plan / usage entitlement for this voice and API |
| 404 voice | Voice ID or account access; add the voice or set `voiceId` |
| 429 | Quota and concurrency; transient responses are retried |
| Voice overruns the card | Shorten the line or lengthen the card/shot and rebuild |
