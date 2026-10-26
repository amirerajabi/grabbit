# Status

Where the project stands, for whoever picks it up next (person or agent). Update it when you release, finish an item
or leave work half done.

_Last updated: 2026-10-26_

## Released

**v1.1.0** (2026-10-26): https://github.com/amirerajabi/grabbit/releases/tag/v1.1.0

- Videos from web pages (yt-dlp, with FFmpeg to join tracks), the site grabber (Batch → Website), FTP and SFTP, archive
  extraction with 7-Zip (multi-part, passwords), proxy settings (system, HTTP, SOCKS5), site logins (Basic, Digest,
  encrypted vault), checksums, virus scan, open when done, and when-done power actions.
- 7-Zip, yt-dlp and FFmpeg are fetched on first use from their GitHub releases (SHA-256 checked) unless installed; see
  `engine/src/core/tools.ts`. Real-world checks done: 7-Zip 26.05 install on Windows, yt-dlp against Wikimedia
  Commons. YouTube is unreachable from the development machine, so it was only covered with the stand-in yt-dlp.
- Windows installer, macOS DMG/ZIP (Apple silicon), Linux AppImage, and extension packages for Chrome, Edge and Firefox.
- v1.0.2 brought the window to the front for captured links; v1.0.1 added the browser extensions; v1.0.0 was the first public release (in-app updates included).

## On `main`, not released yet

Nothing.

An icon and color redesign (the "split arrow" in indigo and mint) was tried and reverted at the user's request on
2026-10-22. The current icon (navy tile, orange arrow) and blue accent stay.

## The developer's machine

- Grabbit **1.0.1** is installed and usually running; it holds port 7310 (`.claude/rules/safety.md`).
- The Chrome extension is installed there as an unpacked extension (Developer mode).
- GitHub CLI is signed in as `amirerajabi` with the `workflow` scope, at `C:\Program Files\GitHub CLI\gh.exe`.

## Open work

- **Store listings for the extensions:** everything is prepared in `store/` (listing text, screenshots, promo tiles,
  step-by-step guide) and `.github/workflows/publish-extensions.yml` publishes each release to all three stores once
  their secrets are set. Waiting on the user: create the developer accounts (Chrome Web Store, one-time US$5; Edge
  Add-ons; addons.mozilla.org), make the first submission by hand, then add the API secrets (store/README.md, part 2).
  The publish script was checked with a dry run and against the real store APIs with fake keys (all three rejected the
  login, as expected); a real upload hasn't happened yet.
- **Code signing:** Windows builds are unsigned (SmartScreen warns), and macOS builds are unsigned (no in-place
  updates on macOS; the app only announces new versions). Both need certificates from the user.
- **Firefox context menus** are not covered by the automated browser test (WebDriver BiDi cannot click menus). The menu
  code is shared with Chromium, where it is tested.

## Ideas not started

From IDM, not built yet: a floating drop target and FTPS. A redesigned UI layout was proposed (four mockups); the user
has not picked one. macOS Intel (x64) builds are not produced either (the release workflow
builds arm64 only).

## History

| Version | Highlights |
| --- | --- |
| 1.1.0 | Video grabbing (yt-dlp), site grabber, FTP/SFTP, archive extraction, proxy, site logins, checksums, virus scan, when-done actions |
| 1.0.2 | The window comes to the front with the Add dialog when a link is captured from the browser or the clipboard |
| 1.0.1 | Browser extensions (Chrome, Edge, Firefox) with "Download all links"; fix for the extension's status check being refused (no `Origin` from Chromium); fix for quick settings changes crashing the engine |
| 1.0.0 | First release: segmented downloads with dynamic splitting, resume, queues and scheduler, speed limiter, categories, batch, tray, clipboard monitor, auto-update |
