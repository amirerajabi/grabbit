# Release rules

- **One version for everything:** `package.json`, `engine/`, `ui/`, `desktop/` (all via `npm version <v>
  --no-git-tag-version` so the lock files follow) and `ENGINE_VERSION` in `engine/src/http/server.ts`. The extension
  takes its version from `desktop/package.json` at build time.
- **The tag is `v<version>`** and must match `desktop/package.json`; the release workflow refuses anything else. Every
  release needs `docs/release-notes/v<version>.md` (the workflow uses it as the release body).
- **Release assets have no spaces in their names** (GitHub would rename them and break `latest*.yml`). The
  `artifactName` patterns in `desktop/electron-builder.yml` set this; keep them.
- **The auto-updater contract:** installed copies read `latest.yml` (Windows), `latest-mac.yml` and `latest-linux.yml`
  from the newest release (`publish:` in `electron-builder.yml` → `amirerajabi/grabbit`). The release workflow checks
  that all three exist, name this version and point at uploaded files. If any is missing, installed copies never see
  the release. Never remove those checks.
- **A version that shipped is never rebuilt under the same number.** Copies that installed it compare versions, not
  checksums. Fix forward with the next patch version.
- **macOS builds are unsigned**, so macOS can't auto-install them (the updater only announces them). Windows builds are
  unsigned too: SmartScreen warns, and the release notes say how to get past it.
- **Building locally on Windows:** `electron-builder.yml` uses `electronDist: node_modules/electron/dist` (no 115 MB
  Electron download). If the build fails extracting `winCodeSign` ("Cannot create symbolic link"), unpack its archive
  into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` with `7za x -xr!darwin` (see the
  `installer-smoke` skill).
- **GitHub API job states can lag:** a finished release run sometimes still lists jobs as queued. Judge a release by its
  assets (`gh release view v<version> --json assets`) and by downloading `latest.yml` and checking the installer's
  SHA-512 against it.
