# Store listing: Grabbit extension

Copy these into the Chrome Web Store, Microsoft Edge Add-ons and addons.mozilla.org (AMO) forms. Images are in
`store/assets/` (make them with `npm run store:assets`).

## Name

Grabbit

## Summary (short description, max 132 characters)

Send links and downloads to the Grabbit download manager for faster, resumable, multi-connection downloads.

## Description

Grabbit is a free, open-source download manager for Windows, macOS and Linux, in the style of Internet Download
Manager. This extension connects your browser to it.

What it does:
• Right-click a link, image, video or audio file and choose "Download with Grabbit".
• Right-click a selection and choose "Download selected links with Grabbit", or right-click a page and choose
  "Download all links with Grabbit". Grabbit shows the links so you can pick the files you want.
• Downloads of common file types (installers, archives, videos, music, documents…) are handed to Grabbit
  automatically, together with the site's cookies, so downloads that need a sign-in still work. You can turn this off
  in the toolbar popup.

Grabbit then downloads each file over several connections at once, so big files finish sooner. You can pause and
resume, even after restarting your computer, and use queues, a scheduler and a speed limit.

You need the Grabbit app, which is free: https://github.com/amirerajabi/grabbit/releases/latest

Privacy: the extension talks only to the Grabbit app on your own computer (127.0.0.1). It collects nothing and sends
nothing to the developer or anyone else. Privacy policy:
https://github.com/amirerajabi/grabbit/blob/main/docs/PRIVACY.md

Open source (MIT): https://github.com/amirerajabi/grabbit

## Category

- Chrome Web Store: Tools (Productivity → Tools)
- Edge Add-ons: Productivity
- AMO: Download Management

## Language

English

## Links

- Homepage / support: https://github.com/amirerajabi/grabbit
- Support: https://github.com/amirerajabi/grabbit/issues
- Privacy policy: https://github.com/amirerajabi/grabbit/blob/main/docs/PRIVACY.md

## Single purpose (Chrome)

Send links and browser downloads to the Grabbit download manager app on this computer.

## Permission justifications (Chrome and Edge ask for each)

| Permission | Why |
| --- | --- |
| `downloads` | To see browser downloads of supported file types, cancel them and hand them to the Grabbit app instead. |
| `contextMenus` | To add "Download with Grabbit", "Download selected links with Grabbit" and "Download all links with Grabbit" to the right-click menu. |
| `cookies` | To send the site's cookies for the file being downloaded to the Grabbit app on this computer, so downloads that require a sign-in work. Cookies are never sent anywhere else. |
| `scripting` | To read the links on the current page when the user chooses "Download all links" or "Download selected links". |
| `activeTab` | Used with `scripting`, only on the tab where the user chose a Grabbit menu item. |
| `storage` | To remember whether automatic capture of downloads is turned on. |
| Host permission `<all_urls>` | Downloads can come from any site, and the cookies for a download's own address are needed to fetch it. The extension also connects to the Grabbit app at http://127.0.0.1:7310. |

Remote code: **No.** All code is in the package.

## Data use / privacy practices

- Chrome "Data usage": tick **Website content** only if asked about reading page links; the extension does not
  collect or transmit user data off the device. Certify: not sold, not used for unrelated purposes, not used for
  creditworthiness.
- Firefox: the manifest declares `data_collection_permissions: none`.
- Edge: same answers as Chrome.

## Firefox (AMO) extras

- License: MIT
- Source code: not needed (plain JavaScript, no build step or minification).
- Notes for reviewers: "The extension only talks to a local desktop app at http://127.0.0.1:7310 (the Grabbit download
  manager, https://github.com/amirerajabi/grabbit). To test it, install the app from the latest release, then
  right-click any link and choose Download with Grabbit."

## Notes for Chrome and Edge reviewers

Same as the Firefox reviewer notes above.
