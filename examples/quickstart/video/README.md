# Demo videos

Scripted, editable walkthrough videos recorded from an isolated Playwright browser. No code is shown on camera.
Each scenario produces:

| File | Contents |
| --- | --- |
| `out/<scenario>/<Name>-voice.mp4` | Title cards and generated narration, no captions: the 1x master |
| `out/<scenario>/<Name>-voice-1.15x.mp4` | The same, re-timed by `npm run speed`: the file that ships |
| `out/<scenario>/clips/<version>/` | Individual scene clips for a video editor |
| `out/<scenario>/captions.srt`, `narration.txt` | Subtitles and the timed narration as spoken |

Default output is 1920×1080, 30 fps H.264. Builds fail above 10 minutes unless the storyboard sets `maxSeconds:`.
`versions:` in the storyboard picks the files: `[voice]` (narration, no captions) is the usual one, delivered as the
`-1.15x` copy from `npm run speed`; `clean` (no voice), `captions-voice` and `captions` exist for when someone asks.
A short version of the same story is another scenario with `takesFrom: <scenario>` and fewer shots: nothing is
recorded twice.

## Record

```sh
npm run signin
npm run record -- <scenario>
npm run record -- <scenario> --shot architecture --ephemeral
npm run frame -- <scenario> <shot> <mark> 1.5
npm run titles -- <scenario>
npm run lines -- <scenario>             # every spoken line with its length, before anything is recorded
npm run build -- <scenario> --plan      # length, scenes and caption/voice warnings, no render
npm run build -- <scenario>             # the versions: in the storyboard (--no-voice: a preview without voice)
npm run qa -- <scenario>
npm run speed -- <scenario> 1.15        # faster copies of the built files (*-1.15x.mp4), no re-record
```

Recording runs in an isolated browser profile under `.local/video/`. It does not capture the desktop or control the
operating-system mouse. The visible cursor is drawn inside the page.

## Edit

Edit `<scenario>/storyboard.yaml` for cards, captions, narration, timing, trims and waits. Edit
`<scenario>/record.mjs` to change on-screen actions. Rebuild to render the outputs; text-only changes never need a
re-record.

## Azure portal scenes

Sign in to the intended Azure tenant with the Azure CLI and use the isolated browser profile for portal capture.
Never show code, secrets, access keys, run inputs/outputs or a terminal on camera. Review contact sheets and require
zero OCR privacy findings before sharing.

## Voice

Choose Azure AI Speech, ElevenLabs, OpenAI or a local system voice in the storyboard. Put provider keys in environment
variables; see the installed skill's `references/VOICE_OVER.md`. Never put secrets in storyboards. Names the voice reads
wrong go in `voice.pronounce` (for example `{ ACMECLOUD: "Acme Cloud" }`); the screen keeps the written form.
