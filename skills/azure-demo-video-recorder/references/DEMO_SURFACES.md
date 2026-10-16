# Demo surfaces: what to put on camera

The video needs something a viewer can watch someone *use*. Pick a surface per scenario:

| Situation | Surface | Notes |
| --- | --- | --- |
| The system has its own web UI | Record that UI | Label synthetic systems clearly |
| Only APIs/CLI exist | Build a small loopback-only demo app | Never show a terminal or code instead |
| The outcome lives in Azure | Logic Apps run view, resource tour or API list | See [PORTAL_RECIPES](PORTAL_RECIPES.md) |
| Explanation only | Architecture diagram or existing simulator | Trace the flow with a visible cursor |

## Loopback demo app pattern

A small ASP.NET Core or Node app can play the "partner system":

- Bind to `127.0.0.1` only; reject non-loopback `Host` headers.
- Protect state-changing requests with a custom header and same-origin `Origin`.
- Use the demo's documented authorization flow. Do not add a hidden login or put credentials in browser code.
- Keep tokens, API keys and hostnames server-side; sanitize error messages.
- Call only the governed interface, never a backend directly.
- Show a read-back card that turns green only when the target confirms the change.
- Use fictional names and generated IDs. Add tests for request guards and error sanitization.
- The recorder may start the app when needed; stop only that child process in `teardown`.

## Apps behind platform authentication

If a protected console rejects writes with an empty 403, use its documented short-lived token hand-off and attach the
token to that exact host only:

```js
await ctx.context.route((url) => url.host === consoleHost, (route) =>
  route.continue({
    headers: { ...route.request().headers(), authorization: `Bearer ${accessToken}` }
  }));
```

Only the user initiates sign-in or grants permission. Keep any token in memory, never print or store it. Routes do not
apply to background polling with `context.request`; attach a scoped token there only if the app requires it.
