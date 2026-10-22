---
name: installer-smoke
description: Build the Windows installer locally, optionally install it, and smoke-test the packaged app (window capture, engine start, auto-update against a local test feed, bring-to-front). Use when changing desktop/ packaging, the updater, startup, or anything only visible in the installed app.
---

# Build and smoke-test the packaged app

Read `.claude/rules/safety.md` first. The user's installed Grabbit is usually running and holds port 7310.

## 1. Build the installer

```bash
npm run build && (cd desktop && rm -rf release && npx electron-builder --win nsis --x64 --publish never)
ls desktop/release   # Grabbit-Setup-<v>.exe, .blockmap, latest.yml, win-unpacked/
```

If it fails with **"Cannot create symbolic link … winCodeSign"** (Windows without Developer Mode), unpack the archive
without its macOS files, then build again:

```bash
cd "$LOCALAPPDATA/electron-builder/Cache/winCodeSign" && A=$(ls *.7z | head -1)
rm -rf winCodeSign-2.6.0 && "$OLDPWD/desktop/node_modules/7zip-bin/win/x64/7za.exe" x -bd -y "$A" -owinCodeSign-2.6.0 -xr'!darwin'
rm -rf [0-9]* *.7z; cd -
```

## 2. Smoke-test without installing

Run the built app with a throwaway profile. It runs next to the user's app (the single-instance lock is per profile),
writes a screenshot of its window, then quits:

```powershell
$sp = "$env:TEMP\grabbit-smoke"; New-Item -ItemType Directory -Force $sp | Out-Null
$env:GRABBIT_USER_DATA = "$sp\profile"; $env:GRABBIT_SMOKE_SHOT = "$sp\shot.png"; $env:GRABBIT_SMOKE_DELAY_MS = '5000'
$p = Start-Process 'desktop\release\win-unpacked\Grabbit.exe' -ArgumentList '--hidden' -PassThru -RedirectStandardOutput "$sp\log.txt"
$null = $p.WaitForExit(60000); Get-Content "$sp\log.txt"
```

Then read `shot.png`: the status bar's connection icon must be green (the UI reached the engine). `--hidden` keeps the
window off the user's screen. The unpackaged dev build works the same way with
`desktop\node_modules\electron\dist\electron.exe .` from `desktop/`.

Environment switches (`desktop/src/main`):

| Variable | Effect |
| --- | --- |
| `GRABBIT_USER_DATA` | Separate profile (settings, list, window state, single-instance lock) |
| `GRABBIT_SMOKE_SHOT` / `GRABBIT_SMOKE_DELAY_MS` | Capture the window after N ms (default 3000) and quit |
| `GRABBIT_UPDATE_FEED` | Updater reads this generic feed instead of GitHub (also unpackaged) |
| `GRABBIT_DISABLE_UPDATES=1` | No update checks |
| `GRABBIT_DEV_URL` | Load the UI from Vite instead of `ui/dist` |

## 3. Test the auto-updater end to end

Serve a fake newer version: a folder with the installer copied as `Grabbit-Setup-9.9.9.exe` and a `latest.yml` from
`desktop/release/latest.yml` with `version: 9.9.9` and that file name (keep `sha512` and `size`). Serve it with any
static server on a free port, then run the smoke command above with
`$env:GRABBIT_UPDATE_FEED = 'http://127.0.0.1:<port>/'` and `GRABBIT_SMOKE_DELAY_MS = '30000'`.

The log must show: `update available: 9.9.9` → `update downloaded` → on quit `Auto install update on quit`. The
screenshot shows "Restart to update to 9.9.9" in the status bar.

Afterwards:

- **Stop the feed server immediately.** The installer relaunches the app with your environment, which would find
  "9.9.9" again and loop.
- Delete `%LOCALAPPDATA%\grabbit-desktop-updater`.
- The update installed the test build over the user's installation. Tell the user, or only do this test when they
  agreed to it.

To check against the real release without installing, point `GRABBIT_UPDATE_FEED` at
`https://github.com/amirerajabi/grabbit/releases/latest/download/`. A copy at the latest version logs
`Update for version X is not available`.

## 4. Bring-to-front (captured links)

Start the app as in step 2 (with `GRABBIT_SMOKE_DELAY_MS = '14000'`), read its engine port from
`log.txt`, then send a link like the extension does:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:<port>/capture" -Headers @{ 'X-Grabbit-Capture' = '1' } -ContentType 'application/json' -Body '{"url":"http://127.0.0.1:7400/files/a.zip?mb=3"}'
```

Then use `user32` `GetForegroundWindow` and a z-order walk (`GetTopWindow`/`GetWindow`) to see that the Grabbit window
is on top. When the user is typing in another app, Windows may keep keyboard focus there; the window must still be on
top, and its taskbar button flashes. Start `npm run test-server` first for the file.

## 5. Install (only when the user asked)

```powershell
Start-Process 'desktop\release\Grabbit-Setup-<v>.exe' -ArgumentList '/S' -Wait
```

A silent install starts the app afterwards. Close only instances you started, and remind the user that their Grabbit
was replaced by this build.
