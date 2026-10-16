# Azure portal shot recipes

All helpers are in `video/engine/portal.mjs`. Navigate **before** `recorder.shot(...)` starts so the portal's loading
and sign-in steps never appear on camera.

## Open any blade by deep link

```js
await openPortal(page, rgFragment(subscriptionId, 'rg-demo-integration'), { waitFor: 'la-demo-intake' });
await openPortal(page, resourceFragment(apimId, 'apim-apis'), { waitFor: 'Sample Integration API' });
await openPortal(page, runFragment(run.id), { waitFor: 'Send command' });
```

`openPortal` builds `https://portal.azure.com/#@<tenant>/<fragment>`, handles the account picker and "Stay signed in?"
(`handleLogin`), waits for the given text in any frame, and hides toasts. The URL bar is never recorded.

## Resource group tour (about 30-45 s)

- Order hover names **alphabetically**, as the grid lists them, in 3-5 groups with a `s.mark()` per group. Each group
  gets one caption ("Two Logic Apps: intake and delivery").
- `hoverAll(page, page.cursor, names, { dwell: 1100 })` scrolls the virtualized grid as needed.
- Subscription name/ID, account and directory are blurred by the redaction layer; resource names stay visible.

## Logic Apps run view (Consumption)

- Find the run: `findRun(workflowId, { after: timestampMs })` (newest Succeeded run after the action you recorded).
- Open it with `runFragment(run.id)`; the designer shows each action with a green check and duration. Scopes are
  already expanded, so **do not click a scope** (it collapses) and **never click a card** (opens inputs/outputs).
- Hover the success path in order. If a failure branch shows a "skipped" note, caption it explicitly.
- Run *contents* can be IP-restricted; statuses still show, and the video does not need contents.

## API Management

- `resourceFragment(apimId, 'apim-apis')` lists APIs (display names truncate; match with `exact: false`).
- Clicking an API opens its Design tab: operations plus policy blocks (validate-content, set-header). That reads as
  governance, not code. Avoid policy tabs dominated by `choose/when/return-response`; for OData use the
  "Entity sets and functions" tab instead.
- The backend URL is a hostname and gets blurred automatically.

## Microsoft Foundry portal (ai.azure.com)

- **Sign-in:** one `npm run signin` (Azure portal) is enough. Entra SSO in the same profile signs ai.azure.com in
  silently; `openFoundry` handles the account picker. If Foundry still shows its signed-out landing page, run
  `npm run signin -- --url https://ai.azure.com --ready "<project name>"`.
- **New Foundry only:** agents created with the v2 API (`agents.create_version`) appear only in the *new* Foundry
  experience. The first visit may open the classic home with a "New Foundry" switch; turning it on asks for a project
  ("Select a project to continue" → pick it → "Let's go"). After that the profile remembers it.
- **Deep links** (navigate before `recorder.shot`): every project page lives under
  `/nextgen/r/<sub>,<resource group>,,<Foundry resource>,<project>/...`, where `<sub>` is the subscription GUID's 16
  bytes in base64url: `Buffer.from(subId.replace(/-/g, ''), 'hex').toString('base64url')`.

  | Page | Path | Wait for |
  | --- | --- | --- |
  | Model deployment details | `/build/models/deployments/<deployment>/details` | `Deployment info` |
  | Agents list | `/build/agents` | the agent name |
  | Agent playground (model, instructions, tools, chat) | `/build/agents/<agent>/build` | `Instructions` |
  | Tools (connections such as MCP) | `/build/tools` | `Model Context Protocol (MCP)` |

- **Model:** use the deployment's **Details** tab (type, provisioning state, TPM/RPM, upgrade policy, "API Key
  authentication is disabled"). Avoid **Build › Models › Deployments**: selecting a row opens a side panel with
  sample code. The key notice is inside a read-only field, so spotlight it from the `Key` label's box.
- **Agent playground:** model = `getByRole('combobox', { name: /^Model:/ })`, instructions = the first `textarea`,
  each tool is a row whose text starts with the connection name (`learn-mcp (https://...)`). Never open the YAML tab
  or "Continue in code".
- **Live question:** the message box is a `contenteditable` span, `getByRole('textbox', { name: /Message the agent/i })`.
  Type with `cursor.type(box, text, { clear: false })`, click **Send**, and wrap the reply in
  `s.wait('reply', () => page.getByRole('button', { name: 'Like this response' }).waitFor({ timeout: 180000 }))`
  (`waits: { reply: { keep: 4 } }`). Under the reply, the run chips (`mcp_list_tools`, the MCP server label,
  `message`) prove the tool call; spotlight them, hover only (they open trace detail). The answer text differs per
  run, so caption the recorded take after looking at its frames.
- **Quieting:** `openFoundry` calls `quietFoundry`, which never presses Escape or clicks "Close" (those shut
  playground panels). The "Welcome to the new Microsoft Foundry" dialog appears only on the project home; deep links
  skip it.

## Things to avoid on camera

- Code view, JSON view, "Export template", Cloud Shell, Kudu/SCM, Log Analytics query editors.
- Secrets blades (Key Vault secret values, access keys, connection strings) even though values are hidden.
- Activity log entries that show other people's names.
