# Local quick start

This example is a loopback-only synthetic partner and project registry. It does not call a real API or deploy Azure
resources. All records are fictional.

From the repository root:

```sh
node skills/azure-demo-video-recorder/scripts/new-demo-video.mjs --target examples/quickstart --scenarios quickstart
npx playwright install chromium
cd examples/quickstart/video
npm run record -- quickstart --ephemeral
npm run titles -- quickstart
npm run build -- quickstart --no-voice
npm run qa -- quickstart
```

The recorder starts the local app on `127.0.0.1:5199` and stops it when capture ends. Outputs are under
`examples/quickstart/video/out/quickstart/`. For optional narration, add a provider to `video/quickstart/storyboard.yaml`
and configure its environment variable as described in the skill's voice reference.
