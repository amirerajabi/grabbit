---
name: test-extensions
description: Build the Grabbit browser extensions and test them in the real Chrome, Edge and Firefox installed on this machine (load, context menus, "download all links", download takeover), plus Mozilla's web-ext lint. Use after changing extension/, the engine's /capture endpoint or capture handling in the UI, or when the user reports an extension problem.
---

# Test the browser extensions

## 1. Build and lint

```bash
npm run build:extensions
npx --yes web-ext@8 lint --source-dir extension/dist/firefox --self-hosted=false --warnings-as-errors --output text | grep -A4 "Validation Summary"
```

The lint must report 0 errors, 0 warnings, 0 notices. It is what addons.mozilla.org checks, and CI runs it too.

## 2. Run the browser tests

```bash
npm run test:extensions                 # every installed browser
node scripts/test-extensions.mjs edge   # or just one: chrome | edge | firefox
```

It is safe to run while the user's Grabbit and browsers are open. Everything runs headless in throwaway profiles, with
its own engine on a random port and scratch download folders (details in the header of `scripts/test-extensions.mjs`).
It takes 1 to 2 minutes.

What it checks:

| Check | Chrome | Edge | Firefox |
| --- | --- | --- | --- |
| Loads, background starts | ✓ | ✓ | ✓ (temporary add-on) |
| Context menus created | ✓ | ✓ | (BiDi can't click menus) |
| Reaches the engine (`GET /capture`) | ✓ | ✓ | via takeover |
| "Download with Grabbit" | ✓ | ✓ | |
| "Download all links" (real page, `scripting`) → only file links queued | ✓ | ✓ | |
| Browser download taken over, no copy left in the browser | ✓ | ✓ | ✓ |

## 3. When a check fails

- **"extension reaches the engine" fails** (or takeover silently does nothing): `engineInfo()` got no answer. Check
  `/capture` in `engine/src/http/server.ts`. Chromium sends **no `Origin`** on an extension's GET, so the engine must
  accept a request with `X-Grabbit-Capture: 1` and no Origin. This bug happened once and is covered by an engine test.
- **Takeover fails but the menus work:** run the harness with extra logging. Evaluate in the service worker
  `chrome.downloads.search({})` and add a probe `chrome.downloads.onCreated` listener to see whether the event fired and
  what `filename`, `fileSize` and `finalUrl` were.
- **Edge "did not open its debugging port":** Edge's launcher hands off to another process; the script already uses
  `--remote-debugging-port` with `--load-extension` for Edge. If the user's Edge is updating, retry.
- **Chrome ignores `--load-extension`** (branded builds since 137). The script loads it through
  `Extensions.loadUnpacked`, which needs `--enable-unsafe-extension-debugging` and `--remote-debugging-pipe`.

## 4. Manual check (optional)

For a visual check in the user's own browser, tell them how to load `extension/dist/chrome` with **Load unpacked**
(`docs/browser-extensions.md`). Do not install extensions into their profile yourself.
