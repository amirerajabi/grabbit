---
name: dev-run
description: Run Grabbit during development (engine + Vite in a browser, or Electron on Vite), point it at safe scratch folders, drive the UI in the browser pane, and avoid the known traps (port 7310 held by the installed app, stale Vite modules). Use when asked to run, preview, debug or screenshot the app while developing.
---

# Run Grabbit in development

## 1. Browser mode (fastest)

The UI runs in a normal browser and talks to a dev engine over HTTP and WebSocket.

- With the preview tools: `preview_start` with `dev` (from `.claude/launch.json`). It opens http://localhost:5173.
- From a shell: `npm run dev`.

Both run `scripts/run.mjs browser`. The dev engine uses token `dev` and keeps its state in `.dev-data/` (gitignored).
The user's installed Grabbit usually holds port **7310**. The launcher then picks a free port, tells Vite
(`VITE_ENGINE_URL`) and prints `Port 7310 is in use … the dev engine uses <port> instead`. Read the port from that line
(or from `preview_logs` with search `engine`); you need it for API calls. Never stop the user's app to get 7310.

**Before downloading anything,** point the dev engine's downloads at a scratch folder (Git Bash; `<port>` from above):

```bash
printf '{"downloadDir":"%s"}' "$(cygpath -m "$TMPDIR/grabbit-dev-dl")" | curl -s -X PUT -H "Authorization: Bearer dev" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:<port>/api/settings
```

For files to download, run `npm run test-server` and use e.g.
`http://127.0.0.1:7400/files/big.iso?mb=200&kbps=800` (Range support and a speed cap per connection; also `/page`,
`/norange/`, `/redirect/` and `/expired/` variants). It uses port 7400. `npm run test:extensions` reuses a test server
that is already running.

## 2. Inspect state

Dev builds expose the stores: `window.__grabbit.ui.getState()`, `.downloads.getState()`, `.engine.getState()` (see
`ui/src/main.tsx`). They're useful from the browser pane's JavaScript tool. Check `wsStatus === 'open'` to confirm the
UI reached the engine.

The engine API needs `Authorization: Bearer dev`, e.g.
`curl -s -H "Authorization: Bearer dev" http://127.0.0.1:<port>/api/state`. To simulate the browser extension, POST to
`/capture` with the header `X-Grabbit-Capture: 1` and body `{"url": "..."}` (or `{"urls": [...]}` for "Download all
links").

## 3. Known trap: stale Vite modules

On this machine Vite's file watcher has missed edits made by tools, and the browser kept running an old module (a store
without a newly added function). If behaviour doesn't match the code, check what Vite serves:
`fetch('/src/store/ui.ts').then(r => r.text())` in the page. If it's stale, restart the dev server; a page reload is not
enough.

## 4. Desktop mode

```bash
npm run dev:desktop
```

This rebuilds the engine bundle and the desktop bundle, starts Vite and opens Electron on it. Electron starts its own
engine from `engine/dist/engine.cjs`. If 7310 is taken, the engine falls back to a random port and Electron passes the
real one to the window. The launcher gives Electron its own profile (`.dev-data/desktop`, via `GRABBIT_USER_DATA`), so
it never shares the installed app's download list or single-instance lock. `npm start` does the same.

Electron can't be screenshotted from the browser pane. Use the smoke-shot switch instead (`installer-smoke` skill,
step 2).

## 5. Clean up

Stop what you started (`preview_stop`, or match command lines, never process names, so the user's apps keep running),
then delete `.dev-data/` and any scratch download folders.
