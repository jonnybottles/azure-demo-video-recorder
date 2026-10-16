# Pitfalls and fixes (learned the hard way)

Each row cost real time on the first run. Check this table before improvising.

## Capture and cursor

| Symptom | Cause | Fix (already in the engine unless noted) |
| --- | --- | --- |
| Blurry UI text in the video | Playwright `recordVideo` may use low-bitrate output | Use `page.screencast.start({ onFrame, quality: 92 })` and assemble frames with ffmpeg |
| No visible mouse | Playwright never moves the OS cursor | Inject an overlay cursor in the top frame (renders above iframes) and glide it with eased Bézier paths |
| Clicks land on the wrong row in the portal | A row was "on screen" by coordinates but hidden behind a sticky header in a scrolling grid | `reveal()` checks `elementFromPoint` in the element's own frame before deciding not to scroll |
| Hover target "not visible" in a large resource list | Portal grids are virtualized; rows below the fold are not in the DOM | Order hover names alphabetically (as listed) and wheel down until the name renders (`hoverAll`) |
| Button clipped on the right of a wide table | Table scrolls horizontally inside its wrapper | Set `wrapper.scrollLeft = wrapper.scrollWidth` before the shot |
| Dropdown list never appears | Native `<select>` popups are OS widgets the page capture cannot see | Visible click on the control, then `selectOption` (`cursor.select`) |
| First frames of a shot are a white page | Shot started on `about:blank` before navigation | `s.mark('loaded')` after load and `trim: [loaded, null]` in the storyboard |
| Cursor becomes enormous on a diagram page | A broad page CSS rule such as `svg { width: 100% }` also styles the injected cursor SVG | Scope diagram rules (`main > svg`, `.architecture svg`) so they do not target the recorder overlay |
| `pause is not a function` | A destructured option named `pause` shadowed the helper | Never name an option `pause`; `click()` uses `before` |
| Demo app keeps running after recording | Child process outlived the recorder | Stop the process using its recorded PID in `teardown`; use a platform-appropriate signal |

## Sign-in and network

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AADSTS90072 ... does not exist in tenant` | The user selected an account from the wrong tenant | Stop at sign-in; ask the user to choose the intended work account in the dedicated browser |
| Session not saved after sign-in | The browser closed before its profile was saved | Let `npm run signin` detect completion and close the context; do not terminate it externally |
| Headless run shows an account picker | The identity provider needs user interaction or the isolated session expired | Re-run `npm run signin`; never type a password or automate MFA |
| App or gateway returns 403 / "IP forbidden" | Egress or allow-list does not match | Check the provider's observed address and ask the user before changing any network rule; never widen ranges |
| App Service Authentication app: reads work, every POST is an empty 403 that never reaches the app | Platform rejects cookie-only writes | Attach the owner's short-lived API token to that host only with `context.route(...)`; get it from the project's one-time loopback hand-off; never print or store it |
| Google: "Couldn't sign you in. This browser or app may not be secure" | Google refuses sign-in in a browser automation launched | `npm run signin -- --manual --url https://mail.google.com`: the installed Chrome opens on the recording profile with no automation; the person signs in and closes the window; record with `DEMO_BROWSER=chrome`. The saved session works headless afterwards |
| Authenticator codes always "invalid", every try | The recording PC's clock is minutes off (seen: 3.6 min slow) | Generate codes from the server's time: `syncClock(url)` + `freshCode()` in `engine/helpers.mjs`; stop after two refusals (lockout rules) |
| Signed out in the middle of a long recorded wait | App inactivity sign-out (often 15 minutes); the drawn cursor is not input | Wrap long waits in `awake(page, promise)`: a one-pixel real mouse move each minute |
| An identity-provider session is gone on the next run | Session cookies (no "remember me") die with the browser | Sign in off camera at the start of every shot that begins inside the app; keep the password and authenticator secret in a private file outside the repo, never printed |

## Redaction and QA

| Symptom | Cause | Fix |
| --- | --- | --- |
| A name was flagged but still readable on a console | The app's Content Security Policy blocked the injected stylesheet | `bypassCSP: true` on the context, and apply `filter: blur()` through the element's style (CSSOM) |
| QA flags the fictional `@example.com` email | OCR reads it as `exampIe.com`, `example.co` or `example.col` | QA normalizes `examp[l1I|]e.c[o0]` plus up to two noise letters before matching (the `example` domain is reserved, so this is safe) |
| Display name shown in an audit trail | Name not in the term list | `prepareTerms()` adds the signed-in display name; add others in `.local/video/redact-extra.json` |
| A demo persona's address is blurred everywhere, even in its own form field | Every address that is not `@example.com` matches the e-mail pattern, input values included | Expected and safe; say the address in a caption only if it is meant to be public. Add its local part as a term so it is blurred inside longer strings too (Linux user names, prompts) |
| An address is readable while it is typed into a form | The e-mail pattern only matches a complete address, so the first part shows until the domain is typed | The engine blurs `type=email` fields, fields named or autocompleted as e-mail/username/login, and any value containing `@` from the first keystroke; in the recorder, also `keepBlur(page, ['input[type=email]'])` before the shot. Check it frame by frame: `npm run frame -- <scenario> <shot> <mark> --to <mark> --step 0.25` and look at every frame |
| QR code of an authenticator set-up visible for a frame | Blurring after load lets the first paint through | `blurInitScript(hosts, selectors)` from `engine/helpers.mjs` blurs from the first painted frame; decode the QR off screen (`secretFromQr`) |
| A shell prompt line gets blurred with the command typed after it | The prompt contains the user name, a redaction term | Off camera, once: set a short prompt (`PS1='\h:\w\$ '`) in `~/.bashrc`, then end the session so the take starts fresh |
| Account-specific portal chrome appears | Portal chrome or tenant context | Blur with a storyboard `blur:` box or add a redaction term; review the contact sheet before delivery |
| A deployment-identifying host is readable (the random part of an app's default domain, such as `<name>-<hex>.<region>.azurecontainerapps.io`) | Only the common Azure host patterns are built in | Add the fragment as a term in `.local/video/redact-extra.json` (read it from the deployment, never guess), then `npm run prepare`. Keep visible what the viewer needs: the app's public name, resource names, prices, request numbers |
| A tenant GUID appears during sign-in | A "Sign in with Microsoft" (or other federated) button was clicked on camera | Sign in off camera, or use the flow that does not show the tenant; GUIDs are blurred by pattern, but do not rely on it for a whole page |
| The QA log is full of "Line cannot be recognized!!" | Tesseract noise on low-contrast frames | Not a finding; only the `QA found N item(s)` lines count |

## Pacing, captions and voice

| Symptom | Cause | Fix |
| --- | --- | --- |
| Video too short and captions flash by | Cursor dwell tuned for speed, not reading | `PACE` (default 1.7) scales every dwell and pause; captions get at least words / 2.7 + 0.6 s |
| Finished video feels slow to a reviewer, or must be shorter by tomorrow | Dwells sized for a first-time viewer; a re-record or rebuild would take hours | `npm run speed -- <scenario> 1.15` re-times the built files (setpts + pitch-kept atempo, sync preserved) into `*-1.15x.mp4` in minutes; 1.25 sounds hurried |
| A series of modular videos says "Module 2 of 4" / "the last of four" and a fifth video is added | Counts baked into kickers, intro lines, Summary lines and output names | Never number a series: kicker "Brand · Product demo", "This short Product demo shows ...", "A separate demo covers ..." ([STORYBOARD](STORYBOARD.md) "Modules"); fixing it later means re-rendering every card and re-voicing those lines |
| A card bullet renders as `[object Object]` | YAML read a colon followed by a space inside an unquoted item ("One page: the team pays") as a key and value | Quote any card `items:`, `summary:` or `subtitle:` text that contains `: ` (the build does not check; look at the closing card in the contact sheet) |
| `short caption` warning | Next caption's mark comes too soon | Shorten the text, move the offset, or lengthen the dwell before the next mark and re-record that shot |
| `voice runs N s late` | Previous spoken line is long | Add a shorter `say:` for the earlier line, or more dwell in the shot, or a `holds:` entry at the mark |
| Several lines late in one shot although its segments are long enough, and one line is placed before the others | A mark is named `start`: `at: start` means the beginning of the shot, so that cue lands at second 0 | Rename the mark (in `shot.json` too, no re-take needed); never name a mark `start` or `end` |
| `voice runs past the end` | Closing narration longer than the closing card | Closing card ≥ 9.5 s and a short `narration:` |
| Numbers read oddly ("two hundred two") | TTS literalism | `say: "Two-oh-two accepted..."` |
| The voice mispronounces the product name | TTS reads an all-caps or invented name as one odd word | `voice.pronounce: { NAME: "Spoken Name" }` in the storyboard ([VOICE_OVER](VOICE_OVER.md)); confirm with a search of `narration.txt` |
| A word is misread (README as "red me") | Ambiguous spelling; "read me" is ambiguous to the voice as well | Phonetic spelling in `pronounce` (`README: "reed me"`), and say "the README file" rather than "README.md" ([VOICE_OVER](VOICE_OVER.md)) |
| Narration reads the screen verbatim ("Live progress: sent, accepted, building, ready") | Captions were written first and doubled as the script | Narration-first ([STORYBOARD](STORYBOARD.md)): write every line before the recorder (context before the click, meaning during, result and transition after), measure with `npm run lines`, size each mark's dwell to its line, fix late lines with `holds:` or `waits.keep`; `versions: [voice]` when nothing should be drawn |
| Red "skipped" notes visible in a Logic Apps run | Failure branches show their skip reason | Hover only the success path and add a caption: "The failure branch was skipped, because nothing failed." |
| Clicking a run card shows JSON | Opens inputs/outputs (data, possibly sensitive) | Never click run cards; hover only |
| Abrupt ending | Narration ran to the last frame | End on an `end` card (≥ 6 s, `narration: "Thank you."`); the build warns when narration ends < 2 s before the end |
| Video creeps past the length cap after adding slides | Shot tails with no narration add up | Measure unnarrated time per shot, then `trim: [null, <last caption end + 2 s>]`; narrate quiet stretches that show real content instead of cutting them |
| Still over the cap after trimming tails | Dead time inside shots (page loads, long typing) | `cuts: [[from, to], ...]` per shot ([STORYBOARD](STORYBOARD.md)); a 9-part, 18-shot story went from 11.5 to 9.6 minutes without a re-record |
| `Video would be N s, over the 600 s limit` but the script genuinely needs it | The cap is a safety net at 10 minutes | `maxSeconds:` in the storyboard raises it; keep it as a net, not a target |
| Laptop-sized web UI unreadable at 1080p | Its text is 12-14 px | `zoomInitScript(hosts, 1.25)`: zooms the page body only; the cursor overlay on the document element stays aligned |
| A word that must never be said shows up in `narration.txt` (slang, a customer name, a standard the product does not apply, an all-caps name the voice mangles) | Draft lines and `pronounce` gaps | Keep a list of words to avoid and search `narration.txt` after every `--plan`; the search must find nothing. Search the phonetic spellings too (`reed me` must find the README line) |
| The overview paragraph runs into the footer of its card | Five long sentences at 32 px | `npm run titles -- <scenario>` and look at the PNG before recording; cut a sentence rather than shrinking the type |
| The next cue after a card starts late | The card's `seconds` is shorter than its narration clip | Card `seconds` = clip length (from `npm run lines`) + 1.5 |
| Reviewers call the narration "slow" or "it just reads the screen" | Lines label what is visible instead of adding context; no bridge lines at scene changes | Rewrite with "What a line does" and "Between scenes: bridge lines" ([STORYBOARD](STORYBOARD.md)), then rebuild; for pace alone, ship the `speed` 1.15x copy |

## Live apps, terminals and shells

| Symptom | Cause | Fix |
| --- | --- | --- |
| "The terminal never showed a prompt" in a browser terminal | tmux/screen draws a status bar as the last line | Look for the prompt on any line (`/[$#]\s*$/m`), not the last one |
| Last take's output still on screen | Browser terminals resume running sessions | End the sessions off camera before the take; a fresh session also shows the login banner again |
| Selectors guessed from source miss on the live page | Labels differ by state (new resource, first run, empty team) | Read the live page off camera first: `inspectShot()` saves each route's text and a screenshot |
| A step works in the portal list but its action fails ("no such ...") a minute after creation | The action looks the item up in a slower index (Azure Resource Graph) | Wait it out inside the recorded wait (it is cut anyway) and retry once; tell the product owner, a real user hits it too |
| `DEMO_INSPECT=/` becomes `C:/Program Files/Git/` | Git Bash rewrites leading-slash arguments and variables | Prefix the command with `MSYS_NO_PATHCONV=1` |
| A regex in a recorder lost its backslashes, or gained invisible characters | It was written through a shell heredoc or `node -e` | Edit recorder files with an editor tool, never through shell string escapes |
| A background build was stopped during the final assembly ("system is running low on memory") | The assembly is one ffmpeg run that decodes every segment of the xfade chain at once: about 4 GB for a 20-minute, 35-segment video, on top of whatever else the PC runs | Free memory before a long build (the person closes browser tabs). The orphaned ffmpeg keeps running after the kill and finishes the clean render on its own; once it has exited (`tasklist`/`ps`) and `ffprobe` shows the full duration, `npm run build -- <scenario> --only voice` (or `--only captions-voice`) reuses that clean file and only renders the rest |
| A background recording was stopped mid-shot ("system is running low on memory") | The host reaps background shells when free memory is critical; the shot's folder has frames but no `shot.json` | Free memory first (the person closes browser tabs; close the recorder's orphaned browser: the processes whose command line names the recording profile folder, never the person's own browser), delete the partial take folder, then re-record that shot. A shot that depends on live state (a build in progress) may need the state redone first; a one-time step cannot be re-taken, so keep those shots short and record them when the machine is quiet |
| The admin session is signed out when the next approval is due | Admin portals sign out after a few idle minutes (often 15) | Batch every admin step (approvals, deletes) into one sign-in; the person signs in again only when another step is due |
| The recorder opens an old e-mail instead of the new one | The earlier run's mail with the same subject sits in the inbox, and conversation view threads them | Off camera: archive the old mail, turn conversation view off, match unread rows only |
| A sign-up with the same address says "you already have access" | Most apps refuse a known address and cannot fully delete a person | A new plus-address of the same inbox per run, and a new secrets file per persona ([STORYBOARD](STORYBOARD.md) "Re-running a sign-up") |
| The first visit to a linked service shows a one-time welcome or "account created" screen | The visit creates the account | Warm it up off camera, wait a minute, record the second visit |
| A one-time step (an e-mailed link, a first-run agreement) was lost mid-take | The link worked once; the screen never comes back | Use the spare persona and redo the steps before it; keep one-time shots short and record them first, with the machine quiet |

## Azure context and portal

| Symptom | Cause | Fix |
| --- | --- | --- |
| Portal shows "You don't have access" (401) on the demo's resources | Azure CLI context may point at a different tenant; portal URLs and subscription IDs come from `az account show` | Re-select the intended subscription/tenant in the same shell before recording, then retry |
| Hovering an API Management policy block pops up its raw XML (code on screen) | The Design view shows a monospace tooltip per policy | Inject `.tooltip, [role="tooltip"] { display: none }` into the `apimanagement` iframe after every navigation |
| API Management form editor says "not available due to dynamic expressions" | Policies with C# expressions open only in the code view | Explain policies with the Design view's named blocks plus a spotlight label per block; never open the code view |
| Policy blocks low in the inbound list are blank when highlighted | The list scrolls inside its own panel | `element.scrollIntoView({ block: 'center', behavior: 'smooth' })` before the spotlight; park the cursor beside the block |
| Clicking the "APIs" menu collapses the menu | The left menu has an "APIs" group header and an "APIs" item | Point at overview cards instead, or pick the second match |

## Accounts and keys

| Symptom | Cause | Fix |
| --- | --- | --- |
| A provider rejects its key | Key, endpoint, permissions or usage plan may be invalid | Check the provider's error and required permissions; keep the secret in an environment variable, never in the storyboard |
| Need a vendor API key | Keys must never be printed, committed or synced | Set the documented environment variable in the local shell; never create a key file in the repository |
| Template change makes the next build slow | Cards are cached by template + spec hash | Expected: every card re-renders (about 15 s each); batch template edits before building

## Delivery

| Symptom | Cause | Fix |
| --- | --- | --- |
| A reworded video was delivered with the old file | The old outputs were still in `video/out/<scenario>/` | Move the old outputs to an archive folder before rebuilding ([SKILL](../SKILL.md) "Changing a finished video") |
| A Google Drive share link still shows a `local-` id after the upload | Drive for desktop writes the new id to its metadata database's `-wal` file first | Copy `metadata_sqlite_db` together with its `-wal` file (under `%LOCALAPPDATA%\Google\DriveFS\<account>\`) to a temp folder and read the id there; the link is `https://drive.google.com/file/d/<id>/view` |
| A shared copy of a replaced video is still in the folder | Replacing a file is two steps | Delete the old shared file only when the person asks, and say which files remain |

## Microsoft Foundry

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ReservedResourceName` deploying a Foundry project connection | Resource names may not contain trademarked words such as `microsoft` | Name connections without them (`learn-mcp`, not `microsoft-learn-mcp`); the agent's display name is not an ARM resource and can keep them |
| New subscription has 0 quota for every recent model | New subscriptions start on Foundry's Free Tier (`quotaTiers`) | Use a subscription with quota or request an increase; check `az cognitiveservices usage list -l <region>` before deploying |
| Agent missing in the Foundry portal | v2 agents only show in the *new* Foundry experience | Turn on "New Foundry" once and pick the project; record with the `/nextgen/r/...` deep links ([PORTAL_RECIPES](PORTAL_RECIPES.md)) |
| Sample code on screen when showing a model | The deployments list opens a side panel with "Call this model" code | Show the deployment's **Details** tab instead |
| `getByText('API Key authentication is disabled')` never becomes visible | The notice is the value of a read-only field | Spotlight from the `Key` label's bounding box and hover by coordinates |
| Redaction blurs a resource group or resource name | The subscription display name is blurred by substring match | Never reuse the subscription's name inside RG or resource names; run `npm run prepare` after every `az account set` |
