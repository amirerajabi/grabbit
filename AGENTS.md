# Grabbit — guide for coding agents

Grabbit is an IDM-style download manager: Electron desktop app + React UI + a Node download engine, plus browser
extensions for Chrome, Edge and Firefox. Public repo: https://github.com/amirerajabi/grabbit (MIT). Its structure and
look follow [Rowlit](https://github.com/hadirajabi80/rowlit).

Read [docs/STATUS.md](docs/STATUS.md) first: what is released, what is on `main` but unreleased, and open work.

## Layout

| Path | What |
| --- | --- |
| `engine/` | Download engine, Node + TypeScript, only dependency `ws`. HTTP API under `/api` (bearer token), events on `/ws`, `/capture` for the extension. `src/core/DownloadTask.ts` (segments, dynamic splitting, retries), `DownloadManager.ts` (queues, scheduler, persistence, progress), `limiter.ts`, `http.ts`. Tests: `engine/test/engine.test.ts`. |
| `ui/` | React 18 + Vite + zustand + lucide. `src/app/commands.ts` is the command registry (toolbar, menus, palette and shortcuts all use it). Stores in `src/store/`. Theme tokens in `src/theme/tokens.css`. |
| `desktop/` | Electron main + preload. Starts the engine as a utility process, window, tray, clipboard watcher, auto-updater (`src/main/updater.ts`). Packaging: `electron-builder.yml`. |
| `extension/src/` | One extension source for all browsers. `scripts/build-extensions.mjs` writes a manifest per browser into `extension/dist/`. |
| `shared/protocol.ts` | Wire types shared by engine, UI and desktop (types only). |
| `scripts/` | `run.mjs` (dev launchers), `build-extensions.mjs`, `test-extensions.mjs` (loads the extensions in real browsers), `test-server.mjs` (local file server). |
| `docs/` | `STATUS.md`, release notes, `browser-extensions.md`, `PRIVACY.md`. |
| `store/` | Extension store listing text, images (`npm run store:assets`) and the publishing guide. `scripts/publish-extensions.mjs` + `.github/workflows/publish-extensions.yml` upload each release to Chrome, Firefox and Edge stores. |
| `.github/workflows/` | `ci.yml` (typecheck, tests, UI build, extension build + Firefox lint), `release.yml` (tag `v*` → installers + extensions → GitHub Release). |

## Commands

Run from the repository root. The development machine is Windows. Command examples use Git Bash (POSIX `sh`) unless
they are Windows-specific (process, window and installer checks), which use PowerShell and say so.

```bash
npm run setup              # npm install in engine, ui, desktop
npm run typecheck          # all three packages
npm test                   # engine tests (~25 s, local servers only)
npm run build              # engine bundle + UI + desktop bundle
npm start                  # build, then launch Electron
npm run dev                # engine (token "dev", data in .dev-data/) + Vite on :5173; engine on 7310, or a free port if taken
npm run dev:desktop        # Vite + Electron (own profile in .dev-data/desktop)
npm run build:extensions   # extension/dist/{chrome,edge,firefox} + zips
npm run test:extensions    # load the extensions in installed Chrome/Edge/Firefox and exercise them
npm run test-server        # files on http://127.0.0.1:7400/files/<name>?mb=N&kbps=K, plus /page, /norange, /redirect, /expired
npm run dist               # Windows installer into desktop/release/
```

A change is done when `npm run typecheck`, `npm test` and `npm run build` pass (CI runs the same, plus the extension
build and the Firefox lint). Run `npm run test:extensions` as well if you touched `extension/`, `/capture` in
`engine/src/http/server.ts`, or capture handling in the UI. Check UI changes in the running app (`dev-run` skill), not
only by typechecking.

## Rules

Read these before changing code. They record what already went wrong once.

- [.claude/rules/code.md](.claude/rules/code.md): code conventions per package.
- [.claude/rules/safety.md](.claude/rules/safety.md): how to test without touching the user's installed Grabbit, their
  downloads or their browsers.
- [.claude/rules/release.md](.claude/rules/release.md): versions, tags, release assets, the auto-updater contract.

## Workflows

Step-by-step guides live in `.claude/skills/*/SKILL.md`. Any agent can follow them:

- `release`: publish a new version (bump, notes, tag, watch CI, verify assets and update metadata).
- `test-extensions`: build and test the browser extensions in real browsers.
- `installer-smoke`: build the Windows installer, install it, and smoke-test the installed app, including updates.
- `dev-run`: run and inspect the app in a browser or Electron during development.
