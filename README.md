# Azure Demo Video Recorder

An editable Playwright and ffmpeg workflow for producing Azure solution walkthrough videos without showing code.
The bundled agent skill guides storyboarding, Azure portal capture, use-case diagrams, redaction, narration and QA.

**Disclaimer:** This is a personal, independent project. It is not an official Microsoft product and is not
affiliated with, endorsed by, or supported by Microsoft.

**Platform support:** tested on Windows. Chromium, macOS and Linux paths are designed to be portable but still need
validation on those platforms.

![Synthetic quick-start video preview](docs/preview.gif)

## What it produces

- `-voice.mp4`: title cards and AI or system narration, nothing drawn on screen (the default), plus a
  `-voice-1.15x.mp4` copy from `npm run speed` that keeps the narration in sync
- On request: `-clean.mp4` (no voice, for live talk-over), `-captions-voice.mp4` (works muted) or `-captions.mp4`
- Per-scene clips, an SRT subtitle file, the timed narration as spoken and OCR contact sheets
- Short cuts and smaller videos from the same recordings (`takesFrom:`), with no second take

The storyboard remains editable: adjust scene order, titles, narration, trims, cuts, held frames and timing, then
rebuild. The script is written first and measured (`npm run lines`), and the recorder is paced to it. The recording
itself is scripted in Playwright; a visible in-page cursor follows the actions. Capture does not record the desktop
or the operating-system cursor.

## Prerequisites

- Node.js 20 or newer and npm
- ffmpeg and ffprobe on `PATH`
- Playwright Chromium (`npx playwright install chromium`) or optional Chrome/Edge installed locally
- `DEMO_BROWSER=chromium|chrome|msedge` selects a browser; `DEMO_PROFILE_DIR` overrides the isolated profile path
- Azure CLI signed in to the correct tenant for Azure portal scenes; local examples do not require Azure credentials
- Optional: Tesseract.js downloads English OCR data on first QA run; allow network access for that initial download
- Optional voice service credentials in environment variables; never put secrets in source or storyboards

Install tools:

| Platform | Node.js and ffmpeg |
| --- | --- |
| Windows | Install Node.js LTS and ffmpeg with `winget install Gyan.FFmpeg.Essentials` |
| macOS | `brew install node ffmpeg` |
| Debian/Ubuntu | `sudo apt-get install nodejs npm ffmpeg` |

For Azure portal recording, install and sign in with the Azure CLI. See Microsoft's official Azure CLI installation
instructions. If the demo app uses network allow-lists, verify the current egress is authorized before recording.

## Quick start: local synthetic example

The example uses a fictional partner app and registry on loopback. It does not deploy Azure resources or contact a
real partner. From the repository root:

```sh
node skills/azure-demo-video-recorder/scripts/new-demo-video.mjs --target examples/quickstart --scenarios quickstart
npx playwright install chromium
cd examples/quickstart/video
npm run record -- quickstart --ephemeral
npm run titles -- quickstart
npm run build -- quickstart --plan
npm run build -- quickstart --no-voice
npm run qa -- quickstart
npm run speed -- quickstart 1.15
```

To add narration, choose a provider in `examples/quickstart/video/quickstart/storyboard.yaml`, set its documented
environment variable and run `npm run build -- quickstart`.

## Scaffold a project

From the repository root:

```sh
node skills/azure-demo-video-recorder/scripts/new-demo-video.mjs \
  --target /path/to/your/project \
  --scenarios scenario-1,scenario-2
```

Windows PowerShell:

```powershell
node skills/azure-demo-video-recorder/scripts/new-demo-video.mjs `
  --target C:\work\your-project `
  --scenarios scenario-1,scenario-2
```

The scaffold copies the engine and example files into `video/`, installs dependencies and adds ignore rules for local
profiles, media, generated frames and output videos. Add `--install-browser` to download Playwright Chromium during
scaffolding; otherwise run `npx playwright install chromium` when needed. Existing storyboards and recorders are preserved.

## Workflow

1. Read `skills/azure-demo-video-recorder/SKILL.md` and its references.
2. Write an audience-first arc: problem, agenda, overview, general requirements, architecture, Azure resources, tool
   introductions and one use-case slide per demo segment. Add an ending and production next steps.
3. Write the narration first: lines that explain what each step does and why (not what the screen says), and a
   bridge line at every scene change. Measure it with `npm run lines`.
4. Script actions in `video/<scenario>/record.mjs`; add marks where lines are spoken and pace each mark to its line.
5. Record in the isolated browser profile. Never show terminals, code views, credentials, secrets or run payloads.
6. Inspect frames and title cards, fix every `--plan` warning, build, then make the 1.15x copy.
7. Run OCR QA on every rendered version and review every contact sheet. Do not share a video with unresolved findings.

Typical commands:

```sh
cd video
npm run signin
npm run record -- scenario-1
npm run lines -- scenario-1
npm run frame -- scenario-1 architecture source 1.5
npm run build -- scenario-1 --plan
npm run build -- scenario-1
npm run qa -- scenario-1
npm run speed -- scenario-1 1.15
```

## Voice and secret handling

The engine supports Azure AI Speech (Entra token), ElevenLabs, OpenAI, and an installed system voice. See
[`VOICE_OVER.md`](skills/azure-demo-video-recorder/references/VOICE_OVER.md) for provider setup. Provider API keys
must be set in local environment variables. `.env`, key files, browser profiles, caches, captured frames and rendered
media are ignored by Git.

## Privacy and limitations

- Redaction runs before pixels are captured. Configure extra sensitive terms locally in
  `.local/video/redact-extra.json`.
- OCR QA detects many common identifier patterns and code-like screens but is not a guarantee. Human review is
  required before sharing.
- Synthetic stand-ins must be labeled as synthetic; never imply they are vendor products or production evidence.
- Azure portal branding appears only when recording an Azure portal. The title-card design is neutral and contains no
  vendor logos.

Azure and other product names are used only to identify the services the tooling can record.

Before contributing or preparing a release, run `npm run check`, `npm test`, `npm run scan:secrets` and
`npm run scan:public`. The public-content check includes lockfiles, hidden files and extensionless text, and requires
another review if the approved preview changes or a new binary appears. These checks do not inspect Git history or
GitHub artifacts; review those separately before publication. Never add a real customer/person watchlist to the tests.

## License

MIT. See [`LICENSE`](LICENSE).
