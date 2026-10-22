# Safety rules: the user's machine is not a test bench

The developer runs Grabbit for real on this machine: an installed copy, their download list, their browsers. Tests must
never touch those.

## The installed app

- The installed Grabbit (`%LOCALAPPDATA%\Programs\Grabbit`, data in `%APPDATA%\Grabbit`) is usually running and holds
  port **7310**. Check with `Get-Process Grabbit` before starting anything that needs that port. Never stop or restart
  it, and never send it test links: they land in the user's real list.
- Run your own instances with a throwaway profile: `GRABBIT_USER_DATA=<scratch dir>`. The single-instance lock is per
  profile, so a separate profile runs next to the user's app. Its engine then takes a random port; read it from the
  output (`Grabbit engine listening on http://127.0.0.1:<port>`).
- The dev engine (`npm run dev`) keeps its state in `.dev-data/`. Point its `downloadDir` at a scratch folder before
  downloading anything (`PUT /api/settings` with `Authorization: Bearer dev`), so nothing lands in the user's
  Downloads. Delete `.dev-data/` when you finish.
- Do not install, reinstall or uninstall Grabbit on the user's machine unless they asked in this session. A silent
  install (`/S`) starts the app afterwards; close only instances you started.

## Updates

- `GRABBIT_UPDATE_FEED=<url>` points the updater at a test feed. An update found in install mode downloads and installs
  on quit, and the relaunched app inherits your environment. With a fake "newer" feed still running, that loops:
  stop the feed server as soon as the check is done, and run such tests with `--hidden` so nobody clicks "Restart to
  update" by accident.
- A smoke run (`GRABBIT_SMOKE_SHOT`) disables updates unless `GRABBIT_UPDATE_FEED` is set. Never point a test at the
  real release while the user's installed app could be updated by it.
- Delete `%LOCALAPPDATA%\grabbit-desktop-updater` after an update test that downloaded a fake version.

## Browsers

- Test extensions only in throwaway profiles (`scripts/test-extensions.mjs` does this). When cleaning up, stop only
  processes whose command line contains your profile path. The user's own Chrome, Edge and Firefox windows stay open.

## Publishing

- Pushing, tagging and publishing releases are visible to the public. Do them only when the user asked in this session.
  Ask before deleting a release or a tag.
- A published release can be hidden with `gh release edit <tag> --draft=true`. That is reversible; deletion is not.
