# Code rules

## Everywhere

- TypeScript strict, ES modules (desktop is CommonJS, bundled by esbuild). Two-space indent, single quotes, semicolons,
  lines up to ~160 characters. Match the surrounding file.
- Comments say why, not what, in full sentences. File headers explain the module's job.
- Types that cross a process boundary (engine ⇄ UI ⇄ desktop) live in `shared/protocol.ts` and are imported with
  `import type`. Never duplicate them.
- Keep dependencies minimal. The engine depends only on `ws` and `ssh2` (SFTP); the extension and build scripts have none (they include
  their own zip writer and PNG encoder). Ask before adding a package.

## Engine (`engine/`)

- Downloads write straight into a pre-allocated `<name>.dlpart` file at each segment's offset, then the file is renamed.
  Segments are persisted on the item, so resume works across restarts.
- Dynamic segmentation: when a connection finishes, `splitLargest()` halves the active segment with the most bytes left
  (never below `MIN_SPLIT`). A running worker re-reads `seg.end` on every chunk, so shrinking it is safe.
- Two abort controllers: the user's pause (`this.abort`) and the per-run worker controller for a fatal segment error.
  A fatal error must never look like a pause.
- Errors that reach no `await` must be caught. An unhandled rejection takes the engine (and every download) down. File
  writes go through `atomicWrite` (unique temp name per call), and settings writes are chained.
- 4xx (except 408/429) fails at once. Everything else retries per connection, `maxRetries` times, with
  `retryDelaySec` between attempts.
- Every behaviour change gets a test in `engine/test/engine.test.ts`. Tests run against a local server, so make the
  server slow enough (see the trickle in the test) for progress ticks and splitting to happen.

## UI (`ui/`)

- Every user action is a command in `src/app/commands.ts` (label, icon, shortcut, `disabled()` reason, `run`). Toolbar,
  menus, palette and keyboard all read the registry. Do not wire a button to logic directly.
- State lives in zustand stores (`src/store/`). Engine events arrive in `src/app/boot.ts` and go to the stores.
- Colours, font sizes and weights only via `src/theme/tokens.css` variables, with light and dark values for each. No
  hex colours in components or `app.css`.
- Rowlit's shell language: glass top bar, tabbed dock, toolbar, details pane, status bar, `Dialog`/`Menu`/`Toasts` from
  `components/common`. Reuse those before making new ones.
- The UI must also work in a plain browser (`npm run dev`): anything native goes through `src/platform.ts`, with a
  browser fallback.

## Desktop (`desktop/`)

- The renderer is sandboxed with context isolation. The only bridge is `src/preload/preload.ts` (`window.grabbit`).
  Channel names live in `src/shared/channels.ts`. Validate every value the renderer sends.
- The engine runs as a utility process with a random token per launch, on port 7310 (the extension needs that port).
  If the port is busy it falls back to a random one.

## Extension (`extension/src/`)

- One source for Chrome, Edge and Firefox: use `const api = globalThis.browser ?? globalThis.chrome`. Per-browser
  differences belong in the manifests in `scripts/build-extensions.mjs` (Firefox: `background.scripts`, gecko id,
  `data_collection_permissions`).
- Every request to `/capture` sends `X-Grabbit-Capture: 1`. Chromium sends no `Origin` on an extension's GET when it
  has host permissions, so the engine must not require one. It rejects web-page origins and requests without the header.
- Anything the extension gives back to the browser (`giveBack`) is skipped by the download takeover, or it would loop.
