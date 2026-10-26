# Publishing the extension to the stores

Everything a store asks for is in this folder:

| File | Use |
| --- | --- |
| `listing.md` | Name, summary, description, category, permission justifications, privacy answers, reviewer notes |
| `assets/1-right-click-menu.png` … `4-browser-downloads.png` | Screenshots, 1280×800 (all three stores) |
| `assets/promo-small-440x280.png` | Small promo tile (Chrome, Edge) |
| `assets/promo-marquee-1400x560.png` | Marquee / large promo tile (Chrome, Edge; optional) |
| `assets/logo-300.png` | Store logo (Edge) |
| `extension/src/icons/icon-128.png` | Store icon (Chrome, AMO) |

Packages: the zips attached to each [GitHub release](https://github.com/amirerajabi/grabbit/releases/latest)
(`Grabbit-Extension-Chrome/Edge/Firefox-<version>.zip`), or `npm run build:extensions` locally.

## Part 1: the first submission (by hand, once per store)

Only the account owner can do this part: it needs your sign-in, the developer agreements and, for Chrome, a payment.

### Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole, sign in with your Google account, accept the developer
   agreement and pay the one-time US$5 registration fee.
2. Click **New item** and upload `Grabbit-Extension-Chrome-<version>.zip`.
3. **Store listing:** paste the description and pick the category from `listing.md`; upload the icon, the four
   screenshots and the small promo tile (and the marquee if you like).
4. **Privacy:** single purpose, each permission's justification and "No" for remote code, all from `listing.md`.
   Privacy policy URL: `https://github.com/amirerajabi/grabbit/blob/main/docs/PRIVACY.md`.
5. **Distribution:** Public, all regions. Click **Submit for review**.
6. Note the **item ID** (the 32-letter ID in the item's URL). That's `CWS_EXTENSION_ID` in part 2.

### Firefox Add-ons (addons.mozilla.org)

1. Go to https://addons.mozilla.org/developers/, sign in (or create a Firefox account) and accept the agreement.
2. **Submit a New Add-on** → **On this site** → upload `Grabbit-Extension-Firefox-<version>.zip`.
3. When asked for source code, answer **No** (no build step or minification).
4. Fill in the summary, description, category (**Download Management**), license (**MIT**), support and homepage
   links, the privacy policy and the reviewer notes from `listing.md`, and upload the screenshots.
5. Submit. AMO checks it automatically and sometimes a reviewer looks at it.

### Microsoft Edge Add-ons

1. Go to https://partner.microsoft.com/dashboard/microsoftedge/overview, sign in with a Microsoft account and register
   as an Edge extension developer (free).
2. **Create new extension** → upload `Grabbit-Extension-Edge-<version>.zip`.
3. **Availability:** Public, all markets. **Properties:** category Productivity, privacy policy URL, website and
   support URL from `listing.md`.
4. **Store listings → English:** description, logo (`logo-300.png`), the small and large promo tiles and the
   screenshots.
5. Paste the reviewer notes into **Notes for certification**, then **Publish**.
6. Note the **product ID** (shown on the extension's overview page). That's `EDGE_PRODUCT_ID`.

Reviews usually take a few days. You'll get an email from each store.

## Part 2: automatic updates (once)

After part 1, every new Grabbit release can update all three stores by itself: `.github/workflows/publish-extensions.yml`
runs when a GitHub release is published and calls `scripts/publish-extensions.mjs`. It needs API credentials, stored as
repository secrets at https://github.com/amirerajabi/grabbit/settings/secrets/actions (**New repository secret**).
A store without its secrets is skipped, so set them up one at a time.

### Chrome: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`

1. In https://console.cloud.google.com create a project, then **APIs & Services → Library → Chrome Web Store API →
   Enable**.
2. **OAuth consent screen:** External, app name "Grabbit publisher", add your own Google account as a test user.
3. **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy the client ID and secret.
4. Get a refresh token by running this and following the prompts (sign in with the account that owns the store item):

   ```bash
   npx --yes chrome-webstore-upload-keys
   ```

5. Save the item ID, client ID, client secret and refresh token as the four secrets.

### Firefox: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`

1. Open https://addons.mozilla.org/developers/addon/api/key/ and click **Generate new credentials**.
2. Save the **JWT issuer** and **JWT secret** as the two secrets.

### Edge: `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`

1. In Partner Center go to **Microsoft Edge → Publish API** and click **Create API credentials**.
2. Save the **Client ID** and **API key**, plus the product ID from part 1, as the three secrets.

### Check it

Run the workflow by hand once: **Actions → Publish extensions → Run workflow**, tag of the latest release. Each store
reports `DONE`, `SKIP` (no secrets) or `FAIL` with the store's message. A store refuses a version it already has, so
the first run after part 1 only succeeds for a newer version.

Locally, the same check without uploading anything:

```bash
DRY_RUN=1 node scripts/publish-extensions.mjs
```

## Updating the images

`npm run store:assets` re-renders `assets/` from `src/frames.html`. `src/app.png` and `src/batch.png` are real captures
of the app (made with `scripts/shoot.mjs` against `npm run dev` with test downloads), framed by `frames.html`.
