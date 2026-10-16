# Storyboard design

## Narrative arc for a customer-ready demo (about 8-9 minutes, hard cap 10)

| # | Scene | Card | Shot content | Target |
| --- | --- | --- | --- | --- |
| 1 | intro | intro + `narration` | — | 6 s |
| 2 | problem | `bullets` (`icon: x`) | Why this matters, 3 pains | 10 s |
| 3 | agenda | `bullets` (`icon: num`, `columns: 2`) | Parts, incl. "Use case N: ..." | 11 s |
| 4 | requirements | `bullets` (`icon: check`) | General summary of the ask, not line by line | 13 s |
| 5 | architecture | section "How it fits together" | **Spotlight walk** of the architecture diagram, one component per step | 60-85 s |
| 6 | stand-ins | `bullets` (`icon: arrow`) | Which systems are synthetic, what they mimic, what is real | 12-14 s |
| 7 | azure | section "What's deployed in Azure" | Resource group tour; first caption says "We're now in the Azure portal..." | 30-45 s |
| 8 | tool deep-dive | section "Inside <service>" | e.g. API Management overview + policy spotlight | 60-100 s |
| 9+ | one per use case | `usecase` card (replaces the section card) | The demo of that use case; prove the outcome | 30-60 s each |
| n-2 | closing | closing + `narration` | 4-5 ✓ bullets of what was proven | 10-11 s |
| n-1 | next | `bullets` (`icon: arrow`) "The path to *production*" | 4 concrete next steps | 12 s |
| n | end | `end` "Thank *you*" + `narration: "Thank you."` | Hold, no narration tail | 7 s |

Include a failure → alert → fix → replay segment when the requirements mention error handling or monitoring.

## Card types

| Type | Fields | Use |
| --- | --- | --- |
| `intro` | kicker, title (`*emph*`), subtitle, chips, footers | Opening |
| `section` | step (optional), title, subtitle | Part divider (spoken: title) |
| `timeskip` | title, subtitle | Hides real waits (spoken: title) |
| `bullets` | icon `x` / `num` / `arrow` / `check`, columns, kicker, title, subtitle, body, items, footers | Problem, agenda, requirements, stand-ins, next steps; with `body` and no items, a "what is it" overview |
| `usecase` | kicker ("Use case 1 of 4"), title, summary, facts `[[Trigger, ...], [Result, ...]]`, diagram | Before each use case |
| `closing` | title, items, footers | Recap |
| `end` | title, subtitle, lines, footers | Final hold |

`body:` is an optional paragraph under the title (about 32 px, 65-70 characters a line). Use it for an overview
that reads better as prose than as bullets; keep it to four or five sentences and give the card enough `seconds` for
its narration (about 2.7 words a second plus a pause). Quote YAML values that contain commas inside flow lists
(`- [Guardrails, "Price shown first, budget alerts"]`), or the comma splits the value. Quote any `items:`, `summary:`
or `subtitle:` text that contains a colon followed by a space, or YAML reads it as a key and the card shows
`[object Object]`.

### The overview card ("What is it?")

When viewers may not know the product, put one overview card early (after the intro, before the first part): a
`bullets` card with a `body:` paragraph and no items, kicker "Overview", title "What is <Product>?", and `narration:`
identical to the paragraph. Four or five sentences in plain words: what it is, what a person does with it, what they
get and how fast, and why that matters (what it replaces). No cost model, no buzzwords ("spin up", "seamless"), no
claims the product does not make. About 80 words reads in about 30 s, so `seconds: 32`. Run `npm run titles` and look
at the PNG: the paragraph must fit above the footer. Once a reviewer approves the wording, reuse it word for word in
every video that needs it (its narration clip stays cached), and keep it out of short cuts that open on the action.

`usecase` diagram: `{ actor, system, cases: [{ text, to }], systems: [...] }`. The first case is the main use case
(wired to the actor); the next two are drawn as «include» (or `rel: extend`); `to:` links a case to an external system
box on the right. Keep labels to 2-5 words; hyphens are made non-breaking.

## Spotlight walks (diagrams, portal views, demo apps)

`engine/spotlight.mjs`: `installSpotlight(page)`, `regionOf(page, { svgTitles | selectors, pad })`,
`spotlight(page, rect, { label, step })`, `clearSpotlight(page)`. It dims everything except one rectangle and shows a
numbered label; works over any page and over portal iframes (use `locator.boundingBox()` for the rect). Use it to:
- walk an architecture SVG node by node (load the SVG into a dark wrapper page; node ids are the SVG `<title>`s);
- explain configuration without code (e.g. API Management Design-view policy blocks: "IP allow-list", "Token check");
- tour a demo app before using it ("Synthetic partner system", "Signs in with OAuth", "Proof it was applied").
One caption per step; dwell about 6.5-8.5 s (`sleep(3900-5000)` × PACE).

### Architecture diagrams as code (Python `diagrams`)

When the ask is a diagram "as code", draw it with the [`diagrams`](https://diagrams.mingrammer.com/) package
(Graphviz must be installed; on Windows prepend `C:\Program Files\Graphviz\bin` to PATH):

- Render **SVG** with the icons inlined as `data:` URIs and wrap it in a dark HTML page that matches the title cards
  (the card background, the accent colour on edges, white labels). Keep a PNG copy for docs.
- Graphviz sizes text with an installed font, so lay out with `fontname: Verdana` and let the page draw labels in a
  narrower font (so text never spills over cluster borders). `Edge()` has its own font defaults: pass the label style
  on every edge. Give multi-line nodes extra `height` so labels do not touch icons.
- Graphviz ids are hashes, so spotlight by label: union the boxes of `svg g.node` / `g.cluster` / `g.edge` groups
  whose `<text>` contains a string. Highlight a node plus its incoming edge, not the source node too, or the box
  overlaps a neighbour.
- If the diagram numbers its edges (1, 2, 3...), leave the spotlight `step` badge off: two numbering schemes on one
  screen confuse viewers.

Agenda = a `bullets` card (`icon: num`, `columns: 2`); summary = the `closing` card.

## Saying where we are

Whenever the video enters a new tool, the first caption names it and says what it is in one clause:
"We're now in Azure API Management, the secure front door...", "We're now in Azure Logic Apps, the low-code workflow
service...", "This is the synthetic partner system...". Record a 4-8 s opening hover (title or header) to carry it.

Rules of thumb:
- One business moment per scene. Section card titles are short claims ("Updates change only HR-owned fields").
- Prove outcomes, do not just click: show the result in the target system or a read-back, not only "202 Accepted".
- Replace real waits (pollers, queues) with a time-skip card (`waits: { name: { title: ... } }`) or keep a few real
  seconds (`{ keep: 3 }`) so the asynchrony is visible but short. A time-skip card speaks its `title` unless it has
  its own `narration:` (a real sentence about what happens during the wait); `seconds:` sizes the card to that line.
- Fictional data only on screen: use clearly invented neutral names and reserved `.example` domains.

## Narration-first (voice without captions)

When the voice is the point (`versions: [voice]`, nothing drawn on screen), write the script before the
recorder and pace the recording to fit it, not the other way round:

1. **Write every line first**: card `narration:` and one `say:` per cue (`text:` stays a one-line summary for
   `captions.srt`, which is still written). Every line adds context (see "What a line does" below); never read the
   screen. Two or three sentences (8-15 s) per cue is a comfortable rhythm; 40-60 cues plus the cards is a normal
   walkthrough. There is no length target for a narrated video: whatever the script needs, paced so nothing runs late.
2. **Measure**: `npm run lines -- <scenario>` synthesizes every line (same cache as the build, no takes needed) and
   prints `shot  mark+offset  seconds  text` plus the total. `--no-voice` prints the reading-time estimate instead.
3. **Size the dwells**: in the recorder, every mark's segment must last at least its line plus about a second. Copy
   the seconds from `lines` into a `LINES` table (shot, then mark) and use `paceToScript(LINES)` from
   `engine/helpers.mjs`: mark with `pace.marker(s, '<shot>')` and call `await pace.fill()` after the action, which
   waits until the line plus 1.2 s has passed since the mark. Hovers and typing inside the segment count towards it, so
   `DEMO_PACE` (2.2 works for a narrated take) no longer has to do the job alone. Card `seconds` = the clip length plus
   about 1.5 s: a card line that overruns makes the next cue late.
4. **After each shot**, `npm run build -- <scenario> --plan --partial` (every card scene is kept in a plan, so card
   timing shows before all shots exist). Fix `voice runs N s late` with a `holds:` entry at the mark or more `keep` on
   a wait, not with a re-take, unless the take is wrong for another reason.
5. `maxSeconds:` raises the length cap (default 600) when the script needs it; it is a safety net, not a target.
6. **Too slow for a reviewer after all?** `npm run speed -- <scenario> 1.15` re-times the built files (video clock and
   pitch-kept narration together, so sync holds) into `*-1.15x.mp4` beside the originals, in minutes, with no re-take
   or rebuild. 1.1-1.15 still sounds like a natural reader; 1.25 sounds hurried.

### Budget: how long a script runs

- Expect about **1.25 s of finished video per second of speech** (cards, transitions, hovers and waits between
  lines). A first cut with 76 spoken lines (960 s of speech) ran 19:40; trimmed to 59 cues plus 11 card lines it ran
  about 17.5 minutes, and the reviewer still found 1x slow and kept the 1.15x copy. So pace the recording a touch
  brisker than the `lines` seconds suggest, or plan on shipping the 1.15x file from the start.
- Trim in this order: unnarrated tails (`trim`), then dead time inside shots (`cuts`), then lines that only repeat
  what the screen shows, and only then content.
- Late lines (`voice runs N s late` in `--plan`) are fixed with `holds:` at the mark (cue `offset: -0.1`) or more
  `waits.<name>.keep`, not with re-takes.

### What a line does (context, not labels)

The most common complaint about a first narrated cut is "the voice just read what was on the screen". A viewer can
read; the narration is there to explain. Think of a colleague explaining the product over your shoulder, not a screen
reader. Around every action a line has one of three jobs:

| When | The line says | Example shape |
| --- | --- | --- |
| Before the click | What is about to happen and why | "There is no ticket for this. You ask for a test environment on one page, and your team's budget pays for it." |
| During | What the screen shows and what it **means**, not the words on it | "Accepted means Azure checked the deployment and started work. Building is where the resources, their private network and the set-up scripts are created." |
| After | The result, and what comes next (a transition into the next action) | "That is the environment ready to use. Next, the dashboard: the same data, now arriving live." |

Rules of thumb:

- **The muted-screen test.** If the line would still be true and useful with the screen muted, it is narration. If it
  only repeats a label, a button name or a list of states ("Live progress: sent, accepted, building, ready"), rewrite
  it so it explains what each state means for the viewer.
- **Transitions carry the story.** Join actions with a sentence that closes one step and opens the next ("Now that the
  request is confirmed, an administrator has to approve it. While that happens off screen, here is what they see").
  Part and closing cards are transitions too, not a re-read of their bullets.
- **Explain the product, not the familiar mechanics.** Sign-up forms, inboxes, passwords and authenticator codes are
  steps every viewer knows: one short line each, no explanation of consent text, legal notices or a welcome e-mail's
  bullet list, and password or code typing cut to a few seconds (`cuts`). A whole account set-up reads well in about
  two minutes. Spend the words on what is different about this product (what "hardened" means, who pays, what happens
  off screen).
- **Say what the options are** when the screen offers a choice people actually make (an operating-system picker, a
  size, a schedule): open it and name the choices, rather than "more options you will rarely need".
- **Plain words, no slang.** "Provision" and "provisioning", never "spin up". "QR code", not "the code". Say "the
  README file", not "README.md". Name the persona or say "you", never both in one sentence. Never name a customer,
  a compliance standard the product does not apply, or anything the viewer cannot see.
- **Facts come from the source, not from the screen.** Verify every claim in the product's code or docs before it goes
  in a line, and keep a fact sheet (topic, what is true, file and line) in the project's notes so a re-record does not
  have to re-verify. Say only what the code does today: "updates install in the background after the first boot", not
  "fully patched before you get it". Where a draft script is wrong, the script changes, not the explanation of the screen.
- **Keep a list of words to avoid** (slang, customer names, standards the product does not apply, internal code
  names) and search `narration.txt` for them after every `--plan`; the search must find nothing.

### Between scenes: bridge lines

The narration has to carry the viewer across every change of place: a card, a scene change, a cut to another app,
a time skip. A first cut usually goes silent there or re-reads the card, and the video feels like a list of clips.
Give every boundary a bridge line that closes what just happened and sets up what comes next:

| Boundary | Weak line | Bridge line |
| --- | --- | --- |
| Part card | "Part two: using the product." | "The account is ready, so from here on this is the product itself: what you see the first time you sign in." |
| Into the inbox | "Here is the e-mail." | "Let's go and find that e-mail; the link in it works once, so this is the only way in." |
| Time skip | "A few minutes later." | "Azure takes about three minutes to build it. While it does, the page keeps you posted, so nobody refreshes or files a ticket." |
| Into another tool | "This is the dashboard." | "We're now in the team dashboard, where the same request shows up as spend against the budget." |
| Closing card | (re-reads the bullets) | "That is the whole journey, from a request to real work, without a ticket or a terminal." |

Rules of thumb:

- The first line after a card is about the scene ahead, not the card just shown. The last line before a card closes
  the scene, so the card itself can be short.
- Part, Summary and closing cards are transitions, not a re-read of their bullets: say what the part is for, or what
  was proven, in one or two sentences.
- An off-screen step (an approval, a background job) gets a line that says what happens there and who does it, so the
  jump in the footage has a reason.
- A cut inside a shot (`cuts:`) never lands on silence: anchor the next cue just after it.

## Captions

- One sentence, 8-16 words, plain language, no jargon the audience would not use. They double as the narration script.
- Anchor each caption to a recorder mark (`at`) with a small `offset`; captions follow the action, not the clock.
- The builder enforces reading time (words / 2.7 + 0.6 s) and trims overlaps; heed its `short caption` warnings.
- Use `say:` for spoken-only rewrites (numbers, acronyms) and `pos: top` when the bottom of the screen matters.

## Recording marks and waits

- `s.mark('name')` right before the moment a caption describes. Never name a mark `start`: `at: start` (and a
  missing `at`) means the beginning of the shot, so a cue anchored to a mark called `start` lands at second 0 and
  every later line runs late. `end` is reserved by `npm run frame` as well.
- `await s.wait('name', () => condition)` around anything slow; the storyboard decides cut / keep / time-skip.
- Put setup (navigation, sign-in, data prep, waiting for background processing) **outside** `recorder.shot(...)`.
- Persist IDs created during recording in `ctx.state` so later shots (and single-shot re-records) can find them.
- Every mark a caption or trim names must be set on every run, even on a branch that skips the action (set it
  anyway); a missing anchor fails the build.

## Editing dead time out of a shot

`trim: [from, to]` keeps one range; `cuts: [[from, to], ...]` removes stretches inside it (page loads, long typing,
a menu that takes a while), each joined with the quick shot crossfade. Values are seconds or mark names. A cut keeps
0.5 s at each edge, so it removes `to - from - 1` seconds. Find candidates by listing, per shot, the time with no
caption on screen; cut those, not moments a caption describes. This is the cheapest way back under the length cap,
and it never needs a re-record.

```yaml
shots:
  - id: account-setup
    trim: [loaded, tail]
    cuts: [[opening, verify], [typing, typed]]   # page load, then 48 typed password characters
    holds: [[totp, 4]]                           # freeze the frame at the mark for 4 s (see below)
```

Prefer mark names over seconds in `trim`, `cuts` and `holds` (set a mark before and after any dead time, and a last
mark such as `tail`): they survive a re-take, numbers do not.

### Splicing a re-takeable segment into a one-time take

A shot that ends with an irreversible click (Deploy, Send, Delete) cannot be re-taken to change only its middle. Record
the changed segment as its own shot that stops short of the click (for example `deploy-options`, which opens the
pickers and names the choices), then copy the original raw take folder (`.local/video/<scenario>/raw/deploy-form`) to
`deploy-form-b` and list three shots: the original trimmed to the segment start (`trim: [loaded, more]`), the new
shot, and the copy trimmed from the segment end (`trim: [summary, tail]`). Keep anything that would contradict the
original take (a suggested name, a count) out of frame in the new shot.

### Redoing a lost live-state take

Some takes are only worth recording while the state is live (a deployment in progress: sent, accepted, building,
ready). If such a take is lost (stopped for low memory, a crash), the state has moved on. Undo it off camera (delete
what the recorder created, after asking the person: even a minutes-old resource is an irreversible delete), clear the
ids in `ctx.state`, delete the partial take folder (frames without `shot.json`) and record both shots again with free
memory.

### Holding a frame for a longer line

`holds: [[<mark or seconds>, <seconds>], ...]` freezes the frame on screen at that point for N seconds, so a longer
spoken line has room without a re-take. The kept range is split there and a still clip (the raw frame on screen at
that moment, 0.1 s fades on both sides) is inserted. A cue anchored `at: <mark>, offset: -0.1` speaks over the frozen
frame; one anchored at the mark itself starts after it. `--plan` lists each hold under its shot. Keep holds at 0.5 s or
more, and place them where nothing is moving (a hold mid-animation looks like a glitch; check the contact sheet).

## Real sign-ups and one-time links

When the story is a new person's first day (request access, confirm an e-mail, set a password and an authenticator,
first sign-in), several steps can be recorded only once: the e-mailed link works once, and first-run screens
(acceptable-use agreements, onboarding) never come back.

- Give each one-time step its own shot, so a failure loses only that step; rehearse the step before it with a dry
  run that stops short of the irreversible click (`DEMO_DRY=1`).
- Keep the link in `ctx.state` until the step has demonstrably finished (a final mark), not just until the shot ends.
- Never let the mail client open the link: read it with `linkTarget()` (`engine/helpers.mjs`), which also swallows
  the click, and open it in the recorder's own page at the start of the next shot (trim to `loaded`).
- Keep a spare identity ready (a Gmail plus-address delivers to the same inbox) in case a one-time shot fails.
- Narrate in the second person ("you request...") so the persona needs no pronouns.
- Record the one-time steps first and carefully, with the machine quiet (browser tabs closed); keep their shots short.
- Admin steps (approving the request, granting access) happen off camera in the person's own signed-in admin session.
  Batch them into one sign-in: admin sessions often sign out after 15 idle minutes.

### Re-running a sign-up with a fresh persona

- Most apps refuse the same address twice ("you already have access"), and many cannot fully delete a person. Use a
  new plus-address of the same inbox (`name+demo2@`, `+demo3@` ...): the app sees a new person, and one redaction term
  (the local part) still covers every variant.
- One secrets file per persona (password and authenticator secret, outside the repository, never printed); never
  reuse an old one.
- Old mail fools the recorder. Off camera, archive (not delete) the earlier run's e-mails and turn the mail client's
  conversation view off, so new mail with the same subject is not threaded into old conversations; match unread rows
  only.
- Sign-up forms usually have rate limits (per address per day, per IP per hour): a failed take can lock you out for
  the day, so rehearse with `DEMO_DRY=1` first.
- Request or record numbers are often shared with real people's requests: open the item and read its name before
  touching anything off camera.

### Linked apps and first visits

- The first visit to a linked service (a code host, a dashboard behind single sign-on) often creates the account and
  shows a one-time "welcome" or "account created" screen. Warm it up off camera, wait a minute, and record the second
  visit.
- A button that opens a new tab: catch it with `const tab = await context.waitForEvent('page')` around the click, and
  give the new page its own cursor.
- Apps that use bearer tokens answer a plain `fetch('/api/...')` from the page with 401. Read state through the UI
  (or wait on what the page shows), not through the API.

## Versions

One output by default, delivered at 1.15x:

| File | Use |
| --- | --- |
| `<output>-voice.mp4` | AI narration, no captions, nothing drawn on screen: the 1x master |
| `<output>-voice-1.15x.mp4` | The same, re-timed by `npm run speed -- <scenario> 1.15`: the file that ships |

`versions: [voice]` is the default to write in the storyboard. Others only when someone asks: `clean` (no captions,
no voice, for a presenter who talks over it live), `captions-voice` (captions and narration, works muted) and
`captions` (captions, no voice); the older three-file set is `versions: [clean, captions, voice]`. When nothing is
drawn on screen the `short caption` warnings are skipped (nothing is read). Per-scene clips go in `clips/<version>/`.
The captions-only render is kept as an intermediate in the work folder unless `captions` is listed. With `--no-voice`
(or no `voice:`), `captions-voice` falls back to a captions-only preview (`<output>-captions.mp4`) so caption timing
can still be checked, and `voice` falls back to the clean render.

## A short cut from the same takes

A second, shorter video never needs new recordings. Make another scenario folder with only a storyboard, and point it
at the long version's takes:

```yaml
output: Product-Demo-Short
takesFrom: product-demo          # raw takes (and their encodes) come from video/product-demo
```

Then drop shots, end shots earlier (`trim: [loaded, <mark>]`) and cut segments (`cuts: [[<mark>, <mark>]]`). Copy
caption text word for word wherever a caption stays: the voice clips are cached by spoken text, so both videos reuse
the same narration and sound the same. A caption whose moment was cut must go too (the build fails on it). Measure with
`npm run build -- <short> --plan` until the length fits, then build. `npm run frame` reads the same takes.

**Modules.** A reviewer who wants "smaller, modular videos" gets one scenario per module, each with `takesFrom:` the
long recording: its own intro card, a use-case card, the module's shots with their cues word for word, a closing card
titled Summary (three or four bullets and a narration that sums up), and the end card. **Never number them**: no
"Module 2 of 4" kicker, no "the first of four short demos", no "next module" or "last module" in the narration, no
number in the output name. More videos will be added later and every count goes stale. The kicker names the company
and the product ("Company · Product demo"), the intro line says "This short Product demo shows ...", and a pointer to
another video is "A separate demo covers ...". Put the "what is the product" overview in the first module only; every
other module opens on the action. Rewrite only the lines at the module boundaries (a line that said "part two starts
with signing in" becomes "Now you can sign in"), and keep every other line identical so the narration clips stay
cached. Numbering parts inside one video ("Part 1 of 2" on its use-case cards) is fine: that count cannot go stale.
Measure the new card lines with `npm run lines`, set each card's `seconds` to its line plus 1.5, then `--plan`, build,
QA and `speed` per module. Three to seven minutes per module is a comfortable range.

Card styling lives in `titles/card.html` (dark stage and neutral green accent). Change it once and every card re-renders
on the next build (cards are cached by content hash). Use fictional systems and neutral visual branding in examples.
