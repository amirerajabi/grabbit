# Browser extensions

Grabbit has an extension for **Chrome**, **Microsoft Edge** and **Firefox** (one source in `extension/src`). Like IDM's,
it:

- adds **Download with Grabbit** to the menu of links, images, video and audio;
- adds **Download selected links with Grabbit** for a selection, and **Download all links with Grabbit** for a whole
  page. The links open in Grabbit's Batch dialog, filtered to file links, so you can pick what to download;
- **takes over browser downloads** of the file types Grabbit captures (Options → Browser & clipboard). The browser's
  download is cancelled and Grabbit downloads the file with several connections, using the page's cookies, so
  downloads that need a sign-in still work;
- shows in its toolbar popup whether Grabbit is running, and lets you turn capturing off.

The extension talks only to the Grabbit app on your own computer (`127.0.0.1:7310`). See [PRIVACY.md](PRIVACY.md).

## Install from a release

Every [release](../../../releases) has a package for each browser: `Grabbit-Extension-Chrome-<version>.zip`,
`Grabbit-Extension-Edge-<version>.zip` and `Grabbit-Extension-Firefox-<version>.zip`.

**Chrome or Edge**

1. Unzip the package into a folder you will keep.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the folder.

**Firefox**

- **To try it:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose the zip.
  Firefox removes temporary add-ons when it restarts.
- **To keep it:** install it from addons.mozilla.org once it is published there (see below). Release builds of
  Firefox only keep add-ons that Mozilla has signed.
- After installing, open the Grabbit toolbar button and click **Allow access to sites**. Firefox asks for site access
  separately, and Grabbit needs it to send your sign-in cookies with downloads.

## Build

```bash
npm run build:extensions
```

This writes the unpacked extensions to `extension/dist/<browser>/` and the store packages to
`extension/dist/grabbit-<browser>-<version>.zip`. The version is the app's (`desktop/package.json`).

## Publish to the stores

The full guide, the listing text and the store images are in [store/](../store/README.md): the first submission to each
store by hand, then automatic updates on every release (`.github/workflows/publish-extensions.yml`). The summary below is
kept for reference.

Each store needs a developer account, which only you can create. After the first submission, each new version is an
upload of the matching zip from the release.

| Store | Account | Cost | Review |
| --- | --- | --- | --- |
| [Chrome Web Store](https://chrome.google.com/webstore/devconsole) | Google account, developer registration | One-time US$5 | Usually a few days |
| [Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge/overview) | Microsoft Partner Center | Free | Up to about a week |
| [Firefox Add-ons (AMO)](https://addons.mozilla.org/developers/) | Firefox account | Free | Automatic checks, sometimes a manual review |

What each store asks for:

- **Package:** the zip for that browser.
- **Description and screenshots:** reuse the README and `docs/screenshot.png`.
- **Privacy policy URL:**
  `https://github.com/amirerajabi/grabbit/blob/main/docs/PRIVACY.md`
- **Why each permission is needed** (Chrome and Edge ask for each one):
  - `downloads`: see and cancel browser downloads to hand them to Grabbit.
  - `contextMenus`: the "Download with Grabbit" menu items.
  - `cookies` and host access to all sites: send the site's cookies with a download, so files behind a sign-in
    download correctly.
  - `scripting` and `activeTab`: read the links of the page when you choose "Download all links".
  - `storage`: remember whether capturing is on.
- **Single purpose (Chrome):** "Send links and downloads to the Grabbit download manager app on this computer."
- **Firefox source code:** not needed. The extension is plain JavaScript without a build step or minification.
- **Firefox data collection:** the manifest declares `none`. Links and cookies only go to the app on your computer.
