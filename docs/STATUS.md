# Status

Where the project stands, for whoever picks it up next (person or agent). Update it when you release, finish an item
or leave work half done.

_Last updated: 2026-10-22_

## Released

**v1.0.2** (2026-10-22): https://github.com/amirerajabi/grabbit/releases/tag/v1.0.2

- Brings the window to the front when a link arrives from the extension or the clipboard (`f765f99`).
- Windows installer, macOS DMG/ZIP (Apple silicon), Linux AppImage, and extension packages for Chrome, Edge and Firefox.
- v1.0.1 added the browser extensions; v1.0.0 was the first public release (in-app updates included).

## On `main`, not released yet

Nothing.

An icon and color redesign (the "split arrow" in indigo and mint) was tried and reverted at the user's request on
2026-10-22. The current icon (navy tile, orange arrow) and blue accent stay.

## The developer's machine

- Grabbit **1.0.1** is installed and usually running; it holds port 7310 (`.claude/rules/safety.md`).
- The Chrome extension is installed there as an unpacked extension (Developer mode).
- GitHub CLI is signed in as `amirerajabi` with the `workflow` scope, at `C:\Program Files\GitHub CLI\gh.exe`.

## Open work

- **Store listings for the extensions:** Chrome Web Store (one-time US$5), Edge Add-ons and addons.mozilla.org need
  developer accounts that only the user can create. Then upload the zips from the latest release; the steps and
  permission justifications are in `docs/browser-extensions.md`. Once on AMO, Firefox users can keep the add-on
  (release Firefox only keeps signed add-ons).
- **Code signing:** Windows builds are unsigned (SmartScreen warns), and macOS builds are unsigned (no in-place
  updates on macOS; the app only announces new versions). Both need certificates from the user.
- **Firefox context menus** are not covered by the automated browser test (WebDriver BiDi cannot click menus). The menu
  code is shared with Chromium, where it is tested.

## Ideas not started

From IDM, not built yet: proxy settings, video/stream grabbing (HLS/DASH), "shut down / sleep when done", per-site
login credentials, and a floating drop target. macOS Intel (x64) builds are not produced either (the release workflow
builds arm64 only).

## History

| Version | Highlights |
| --- | --- |
| 1.0.2 | The window comes to the front with the Add dialog when a link is captured from the browser or the clipboard |
| 1.0.1 | Browser extensions (Chrome, Edge, Firefox) with "Download all links"; fix for the extension's status check being refused (no `Origin` from Chromium); fix for quick settings changes crashing the engine |
| 1.0.0 | First release: segmented downloads with dynamic splitting, resume, queues and scheduler, speed limiter, categories, batch, tray, clipboard monitor, auto-update |
