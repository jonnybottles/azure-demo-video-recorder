---
name: azure-demo-video-recorder
description: >-
  Use this skill whenever the user asks to record or edit an Azure demo video, screen-record a proof of concept,
  make an end-to-end Azure walkthrough, show deployed Azure resources or a live web app journey (sign-up e-mails,
  authenticator, first sign-in), or add captions or AI narration. Produces editable, re-renderable video from
  Playwright browser capture with a visible cursor, title cards, Azure portal and Microsoft Foundry walkthroughs,
  business use-case diagrams with component spotlights, narration written first and paced to the script, identifier redaction, OCR checks,
  per-scene clips, short cuts from the same takes and faster re-timed copies. No code is shown on camera. Requires
  Node.js, ffmpeg and an Azure CLI sign-in for portal scenes.
---

# Record Demo Video

Produce scripted, re-renderable demo videos from a storyboard file, recorded off-screen from the live deployment: by
default one narrated video (no captions on screen) delivered as a 1.15x copy, plus per-scene clips. The engine in
`assets/` already solves capture quality, cursor, redaction, portal sign-in quirks, pacing, captions, voice, short
cuts, re-timing and QA; copy it, do not rebuild it.

**Architecture default:** explain Azure diagrams with a component-by-component spotlight walk, not a static image
and cursor hovers alone. Use the bundled cyan outline, dimmed surroundings, numbered label and smooth transitions,
synchronized to the explanation of each component. Keep this visual guidance in voice-only and clean versions;
"no captions" does not disable spotlights. Omit the effect only when the user explicitly requests it.

## Prerequisites

- Node.js 20 or later, ffmpeg/ffprobe, npm, and a supported operating system (Windows, macOS or Linux).
- Playwright's bundled Chromium (`npx playwright install chromium`); optional installed Chrome or Edge via `DEMO_BROWSER`.
- Azure CLI signed in to the demo tenant for portal scenes. Local-only examples do not need Azure credentials.
- Optional voice providers: Azure AI Speech with an existing data-plane role, ElevenLabs, OpenAI, or an installed
  system voice. API credentials are read from environment variables and must never be placed in storyboards.
- Keep browser profiles, tokens and media in the ignored `.local/` folder, not in source control or synced storage.

## Workflow

### 1. Intake (one `ask_user` form)

Ask, with these defaults:

| Question | Default |
| --- | --- |
| Scenarios and what each must prove | from the repo's README/requirements |
| Versions | one, unless told otherwise: `voice` (AI narration, no captions; diagram spotlights stay enabled), delivered as the 1.15x copy from `npm run speed -- <scenario> 1.15` (the 1x build stays beside it as the master). Clean (no voice, for live talk-over), captions with voice, or captions only on request (`versions:`, [STORYBOARD](references/STORYBOARD.md), "Narration-first") |
| Audience / redaction | customer-facing: blur account, tenant, subscription IDs, hostnames, IPs; keep resource names |
| Length | about 5 minutes for a short demo; 8-9 minutes with the full arc below. A narrated walkthrough has no length target: whatever the script needs (`maxSeconds:` is a safety net). Both a long and a short one? Record once for the full story and cut the short one from the same takes (`takesFrom:`) |
| Series | smaller videos for a reviewer are scenarios cut from one recording, **never numbered** (no "Module 2 of 4"): more will follow and every count goes stale |
| Demo surface per scenario | existing UI; if only APIs/CLI exist, build a loopback demo app ([DEMO_SURFACES](references/DEMO_SURFACES.md)) |
| Voice engine | User choice: Azure AI Speech, ElevenLabs, OpenAI, or installed system voice ([VOICE_OVER](references/VOICE_OVER.md)), plus a `pronounce` map for product names |
| Story extras | problem, agenda, requirements summary, overview card, stand-in disclosure, use-case slide per part, path to production, end card (recommend all) |
| Persona (sign-up journeys) | a mailbox the person controls (a Gmail plus-address per run); its secrets in a private file outside the repo |
| Failure/replay segment | ask; it adds about a minute (include it when the requirements mention error handling) |

State up front: recording runs in a hidden browser, does not capture their screen or use their mouse, and they can
keep working. (Users ask this; answer it plainly.)

### 2. Preflight

1. Tools present; `az account show` is the demo tenant.
2. The live app runs the code you are describing (a health or version endpoint shows the deployed commit).
3. Egress check: compare the Azure-observed address (for example the `x-ms-keyvault-network-info` header from any
   vault in the demo) with the project's allow-list. On VPN → ask the user to disconnect. New home IP → ask for
   explicit approval to **replace** an exact /32 (never widen), then apply it with the project's own scripts.
4. Deployment healthy: required workflows enabled, demo apps reachable, demo client tokens cached.
5. Clock: compare `date` with the app's `Date` header. Authenticator codes must follow the server's time
   (`syncClock()` in `engine/helpers.mjs`); a PC a few minutes off makes every code "invalid".
6. Admin steps (approvals, grants) are done by the person, off camera, in their own signed-in admin session: plan
   them into one sign-in. Old e-mails from an earlier run are archived off camera.
7. Voice: confirm the selected provider and prerequisites in [VOICE_OVER](references/VOICE_OVER.md); do not request
   credentials in chat.

### 3. Scaffold

```powershell
node skills/azure-demo-video-recorder/scripts/new-demo-video.mjs --target <repo-root> --scenarios scenario-1,scenario-2
```

Creates the engine, title template, package, README, example storyboard/recorder and ignore rules, then installs npm
dependencies. Existing storyboards and recorders are never overwritten; use `--refresh-engine` to update the engine
and `--install-browser` to download Playwright Chromium.

### 4. Demo surface

If a scenario has no UI, build the loopback demo app first, test it, then wire it into `setup`/`teardown`
([DEMO_SURFACES](references/DEMO_SURFACES.md)). Never show a terminal, IDE, JSON editor or code view instead.

### 5. Sign-in hand-off (user action)

Run `npm run signin` in a headed, isolated browser profile. The user signs in themselves and completes any tenant
prompts. Never enter credentials or bypass browser security warnings. Later headless runs reuse the isolated profile.
Google (Gmail) refuses sign-in in automation-launched browsers: use `npm run signin -- --manual --url <site>`, which
opens the installed Chrome on the same profile with no automation; the user closes the window when done, and
recordings run with `DEMO_BROWSER=chrome`. For sites whose signed-out page lives on the same host (ai.azure.com), add
`--ready "<text only shown when signed in>"`.

A demo persona the user created for the video (a fresh Gmail for a sign-up story) may be signed in to the app by the
recorder: with the user's go-ahead, generate its password, enrol its authenticator from the QR code off screen and keep
both in a private file outside the repository (`engine/helpers.mjs`: `newPassword`, `secretsFile`, `secretFromQr`,
`freshCode`). Never do this for a real person's account.

### 6. Script (before the recorder)

**Narration adds context; it never reads the screen.** This is the most common complaint about a first cut ("the
voice just read what was on the screen"), so write the script before the recorder and record to fit it
([STORYBOARD](references/STORYBOARD.md), "Narration-first"):

1. **Fact sheet.** Verify every claim against the product's code or docs (topic, what is true, file and line) and keep
   it in the project's notes, so a re-record does not have to re-verify. Nothing from it is cited on screen.
2. **Arc.** Follow [STORYBOARD](references/STORYBOARD.md): intro → problem → agenda → (overview card) → requirements →
   architecture spotlight → stand-ins → Azure resources → tool deep-dive → one `usecase` card + demo per use case →
   recap → path to production → end card. Name each tool the first time the video enters it ("We're now in Azure API
   Management, ...").
3. **Lines.** Every spoken line does one of three jobs around an action: *before* the click, what is about to happen
   and why; *during*, what the screen shows and what it means (not the words on it); *after*, the result and what comes
   next. Think of a colleague explaining the product over your shoulder, not a screen reader. Test: if a line would
   still be true with the screen muted, it is narration; if it only repeats a label or a button name, rewrite it.
4. **Transitions carry the story.** Every card, scene change, time skip or jump to another app gets a bridge line that
   closes what just happened and sets up what comes next ("Let's go and find that e-mail; the link in it works once").
   Part and closing cards are transitions, not a re-read of their bullets ([STORYBOARD](references/STORYBOARD.md),
   "Between scenes: bridge lines").
5. **Brisk on the familiar, slow on the product.** Sign-up forms, inboxes, passwords and codes get one short line
   each; spend the words on what is different about this product, and when the screen offers a real choice (an
   operating system, a size, a schedule), open it and name the options.
6. **Plain words.** "Provision", not "spin up"; "QR code", not "the code"; the persona's name or "you", never both in
   one sentence. Keep a list of words to avoid and search `narration.txt` for them after every `--plan`.
7. **Measure.** `npm run lines -- <scenario>` prints every spoken line with its length (synthesized and cached, no
   takes needed). Copy the seconds into the recorder's `LINES` table for `paceToScript()` and set each card's
   `seconds` to its clip length + 1.5. `npm run titles -- <scenario>` renders the cards: look at the PNGs (an overview
   paragraph must fit).

### 7. Recorder

Write one recorder shot per on-screen segment using the template patterns: navigate before `recorder.shot(...)`, a
mark before each spoken moment (`pace.marker(s, '<shot>')`, then `await pace.fill()` after the action), `s.wait()`
around slow work, IDs in `ctx.state`. Portal and Foundry shots: [PORTAL_RECIPES](references/PORTAL_RECIPES.md).
Architecture shots MUST call `installSpotlight`, resolve the actual component regions with `regionOf`, call
`spotlight` at the corresponding narration marks, and `clearSpotlight` for the closing whole-diagram view. Follow
the runnable starter template and [STORYBOARD](references/STORYBOARD.md), "Spotlight walks". Fail on a missing
target; never silently replace the effect with cursor hovers. Use numbered labels unless the diagram already has
step numbers. Keep the focused component and its label readable and entirely on screen.
Configuration and app tours can use the same `engine/spotlight.mjs` (never show code; for API Management policies
hide the XML tooltips). Live-app journeys (sign-up e-mails, authenticator, idle sign-out, small UI text, reading pages before
scripting them): `engine/helpers.mjs` and "Real sign-ups and one-time links" in [STORYBOARD](references/STORYBOARD.md).
Read a live page before scripting it: the off-camera `inspectShot()` saves each route's text and a screenshot.

### 8. Record, lowest risk first, and look at every shot

1. Local shots (`--shot architecture --ephemeral`), then portal shots, then live walkthrough shots. One-time steps
   (an e-mailed link that works once, a first-run agreement) are recorded first and carefully, each in its own short
   shot, after a `DEMO_DRY=1` rehearsal that stops short of the irreversible click (the recorder checks
   `process.env.DEMO_DRY` and skips that click). Narrated takes record well with `DEMO_PACE=2.2`.
2. After each shot: `npm run frame -- <scenario> <shot> <mark> 1.5` and **view the JPEG**. Check cursor position,
   blur, clipped controls, unexpected dialogs. Then `npm run build -- <scenario> --plan --partial`.
   For an architecture walk, inspect every focus step, a transition and the closing whole-diagram view; confirm
   the spotlight follows the spoken component, dims unrelated regions and does not clip labels.
3. Fix and re-record only the failing shot. Unknown failures: check [PITFALLS](references/PITFALLS.md) first. A shot
   that clicks something irreversible cannot be re-taken: splice a re-takeable segment into it instead
   ([STORYBOARD](references/STORYBOARD.md), "Splicing").

### 9. Build

Tune with `npm run build -- <scenario> --plan` first: it prints the length, each scene and the kept seconds of every
shot (holds included), and every `short caption`, `voice runs N s late` and `voice runs past the end` warning, in a
minute or two instead of a full render (the narration is synthesized and cached on the way). Fix every warning (text,
`say:`, offsets, closing `seconds: 9.5`, a `holds:` entry or more `keep` on a wait), then run
`npm run build -- <scenario>`. Text-only fixes never need re-recording.

Expect about 1.25 s of video per second of speech. Over the length you want? Trim unnarrated tails
(`trim: [null, <last caption end + 2>]`), then remove dead time inside shots with `cuts: [[from, to], ...]`, before
cutting lines or content. Product names the voice gets wrong go in `voice.pronounce`
([VOICE_OVER](references/VOICE_OVER.md)). A full 1080p build of a 10-20 minute story takes 15-25 minutes (the final
assembly is one long ffmpeg run that needs about 4 GB for 20 minutes of video): start it in the background, run builds
one at a time, and ask the person to close browser tabs first. If the host stops the build for low memory, the
orphaned ffmpeg still finishes the clean render; then `npm run build -- <scenario> --only voice` reuses it.

The deliverable is the 1.15x copy: after the build, `npm run speed -- <scenario> 1.15` re-times every built version
(video clock plus pitch-kept narration, so sync is preserved) into `<output>-<version>-1.15x.mp4` beside the 1x
master, a few minutes per file. A narrated video at 1x reads slow to reviewers; 1.15 still sounds like a natural
reader, 1.25 sounds hurried (reviewers who ask for "25 percent faster" settle on 15). Ship the 1.15x file unless the
user asks for the 1x one.

The build writes `<output>-voice.mp4` (or the `versions:` asked for), per-scene clips in `clips/<version>/`,
`captions.srt`, `narration.txt` and `build-report.json`. A short cut of the same story is a second scenario with
`takesFrom: <long scenario>`: no new recordings, same narration clips ([STORYBOARD](references/STORYBOARD.md)). Short
cuts build in a few minutes once the shots are cached.

### 10. QA

`npm run qa -- <scenario>` OCRs every version the build wrote (from `build-report.json`) and must report zero
findings ("Line cannot be recognized!!" in the log is Tesseract noise, not a finding). Then view the contact sheets in
`.local/video/<scenario>/qa/` for code-like screens, unblurred names, error-looking states and awkward transitions.
Anything typed into a form that holds an address: check it frame by frame
(`npm run frame -- <scenario> <shot> <mark> --to <mark> --step 0.25`) and look at every frame. Search `narration.txt`
for the words to avoid. Explain any visible "skipped"/historical failures with a line instead of hiding them.

### 11. Deliver

- Ship only the file that was asked for (by default `<output>-voice-1.15x.mp4`); the 1x master stays local.
- A delivery e-mail is drafted, never sent: no recipient until the person names one; one entry per video with its
  title, its length, two or three sentences on what a viewer sees, and the link. Numbering the entries in an e-mail
  is fine; the videos themselves are never numbered.
- Replacing a shared video: delete the old shared file only when the person asks, and say which files remain.

### 12. Clean up and report

Stop demo apps started for recording; leave cloud state as found, or list what remains (resources, snapshots,
projects, the persona's account and its end date) by exact name with its running cost. Ask before deleting anything:
even a resource the recorder created minutes ago is an irreversible delete. Keep the browser profile until the user
approves the videos, then delete `.local/video/browser-profile` (it holds the mailbox session).

## Changing a finished video without re-recording

Wording, card text, output names, which cuts go in and the speed all change from the storyboard alone:

1. Edit the storyboards: `output:`, card `kicker:`/`title:`/`narration:`, cue `say:`. Several scenarios at once: a
   small scratch script beats hand edits and keeps the wording identical across them (the voice cache is keyed by
   text, so identical lines are not re-synthesized).
2. `npm run lines -- <scenario>` and set every changed card's `seconds:` to its clip length + 1.5.
3. `npm run build -- <scenario> --plan`: no `voice runs N s late` or `past the end` lines.
4. Move the old outputs out of `video/out/<scenario>/` into an archive folder under `.local/video/` first, so nobody
   delivers a stale file.
5. Build (shots stay cached), `npm run speed -- <scenario> 1.15`, `npm run qa -- <scenario>`, view the card frames and
   contact sheets, then search `narration.txt` for anything that should have gone.
6. Deliver as in step 11.

## Hard rules

- No code on screen. No secrets blades. Never click Logic Apps run cards (inputs/outputs). Fictional data only.
- Never enter credentials, read keys, create resources or role assignments, or change network rules without explicit
  approval for that exact change. Never widen an allow-list.
- Never sign in as a real person or type their password. Admin actions happen off camera in the person's own
  signed-in session.
- Never name a customer in what you write: cards, narration, form text typed on camera, approval notes. Never claim
  a certification, authorization or compliance status the product does not have. The product's own on-screen text is
  the product owner's call, not the video's.
- Nothing irreversible (deletes, offboarding, data moves) without asking; clean-up is a question for the person.
- Redaction stays on; a video ships only after QA passes and frames were reviewed.
- Everything generated lives in the repo's `video/` and ignored `.local/video/`; do not sync browser profiles or private media.

## Error handling

| Error | Likely cause | Recovery |
| --- | --- | --- |
| `AADSTS90072` during sign-in | Wrong "Connected to Windows" tile | Re-run `npm run signin`; "Use another account" |
| `Portal page did not show` / login loop | Session expired | `npm run signin` |
| `Foundry shows its signed-out page` | Foundry session not established | `npm run signin -- --url https://ai.azure.com --ready <text>` |
| `Ip Forbidden` / 403 from apps | Egress not allow-listed | Preflight step 3 |
| Empty 403 on console writes only | Easy Auth rejects cookie-only writes | Bearer token route ([DEMO_SURFACES](references/DEMO_SURFACES.md)) |
| `Text not visible after scrolling` | Name typo or tour not alphabetical | Fix the list order/name |
| `Shot "x" has not been recorded` | Storyboard references a missing shot | Record it or use `--partial` |
| `Mark "x" not found in shot "y"` | A trim, cut or hold names a mark the take never set | Set the mark on every run (even on a skipped branch) and re-take, or use seconds |
| `Speech synthesis failed (401/403)` | Provider key, role or endpoint is invalid | [VOICE_OVER](references/VOICE_OVER.md) |
| `Video would be N s, over the 600 s limit` | Too much content | Trim tails, cut dead time, drop a scene; if the script genuinely needs it, `maxSeconds:` in the storyboard raises the cap |

## Output format

Finish with a short table (keep the message under ~150 words):

| Scenario | Length (1x / 1.15x) | Delivered file |
| --- | --- | --- |
| 1: \<title\> | 9:20 / 8:07 | `video/out/scenario-1/<Name>-voice-1.15x.mp4` |
| 1 short | 6:10 / 5:22 | `video/out/scenario-1-short/<Name>-Short-voice-1.15x.mp4` |

Then: where clips/SRT/narration live, how to edit (`storyboard.yaml` → `npm run build`), any cloud or data changes
made during recording, and cleanup items still pending.

## References

| File | Load when |
| --- | --- |
| [PITFALLS.md](references/PITFALLS.md) | Anything fails or looks wrong; before improvising a workaround |
| [STORYBOARD.md](references/STORYBOARD.md) | Writing the script, scenes, bridge lines, marks, waits, holds, cuts, short cuts and modules |
| [PORTAL_RECIPES.md](references/PORTAL_RECIPES.md) | Any Azure portal or Microsoft Foundry shot |
| [DEMO_SURFACES.md](references/DEMO_SURFACES.md) | No UI to record, or Easy Auth consoles |
| [VOICE_OVER.md](references/VOICE_OVER.md) | Setting up or fixing the AI voice-over, pronunciation |
| `assets/templates/` | Example storyboard, recorder and project README copied by the scaffold |
| `assets/engine/` | The engine; patch here (and `--refresh-engine`) when a fix should apply to future projects |

## Post-Run Reflection

After each run, add any new failure and its fix to [PITFALLS.md](references/PITFALLS.md). If you changed engine code
in a project's `video/engine`, copy the fix back into this skill's `assets/engine` so the next project starts with it.
Product-specific facts (routes, labels, selectors, timings) belong in the project's own notes, not in this skill.
