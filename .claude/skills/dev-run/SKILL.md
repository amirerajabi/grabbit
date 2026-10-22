---
name: dev-run
description: Run Grabbit during development (engine + Vite in a browser, or Electron on Vite), point it at safe scratch folders, drive the UI in the browser pane, and avoid the known traps (port 7310 held by the installed app, stale Vite modules). Use when asked to run, preview, debug or screenshot the app while developing.
---

# Run Grabbit in development

## 1. Browser mode (fastest)

The UI runs in a normal browser and talks to a dev engine over HTTP/WebSocket.

- With the preview tools: `preview_start` with `engine`, then `ui` (from `.claude/launch.json`). Open
  http://localhost:5173.
- From a shell: `npm run dev`.

The dev engine uses token `dev` and keeps its state in `.dev-data/` (gitignored). Delete it when you are done.

**Port 7310 is usually taken** by the user's installed Grabbit. The dev engine then logs
`port 7310 busy, using a random port`, and the UI (which expects 7310) shows an engine error. Do not stop the user's
app. Pick a port and point the UI at it:

```bash
(cd engine && npx tsx src/index.ts --port 23850 --token dev --data-dir ../.dev-data) &
(cd ui && VITE_ENGINE_URL=http://127.0.0.1:23850 npx vite --port 5174 --strictPort) &
```

Then open http://localhost:5174.

**Before downloading anything,** send the dev engine's downloads to a scratch folder:

```bash
printf '{"downloadDir":"%s"}' "$(cygpath -m "$TMPDIR/grabbit-dev-dl")" | curl -s -X PUT -H "Authorization: Bearer dev" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:23850/api/settings
```

For files to download, run `npm run test-server` and use e.g.
`http://127.0.0.1:7400/files/big.iso?mb=200&kbps=800` (Range support, a speed cap per connection; `/page`,
`/norange/`, `/redirect/`, `/expired/` variants).

## 2. Inspect state

Dev builds expose the stores: `window.__grabbit.ui.getState()`, `.downloads.getState()`, `.engine.getState()` (see
`ui/src/main.tsx`). Useful from the browser pane's JavaScript tool.

The engine API needs `Authorization: Bearer dev`, e.g. `curl -s -H "Authorization: Bearer dev" http://127.0.0.1:<port>/api/state`.
To simulate the browser extension, POST to `/capture` with header `X-Grabbit-Capture: 1` and body `{"url": "..."}`
(or `{"urls": [...]}` for "Download all links").

## 3. Known trap: stale Vite modules

On this machine Vite's file watcher has missed edits made by tools: the browser kept running an old module (a store
without a newly added function). If behaviour does not match the code, check what Vite serves:
`fetch('/src/store/ui.ts').then(r => r.text())` in the page. If it is stale, restart the Vite server. A page reload is
not enough.

## 4. Desktop mode

```bash
npm run dev:desktop
```

This rebuilds the engine bundle and the desktop bundle, starts Vite and opens Electron on it. Electron starts its own
engine from `engine/dist/engine.cjs`, so after engine changes it needs `npm --prefix engine run bundle` (the script
does it).

Electron can't be screenshotted from the browser pane. Use the smoke-shot switch instead (`installer-smoke` skill,
step 2). Run it from `desktop/` with `node_modules\electron\dist\electron.exe .`.

## 5. Clean up

Stop what you started (match command lines, not process names, so the user's apps keep running), and delete
`.dev-data/` and scratch download folders.
