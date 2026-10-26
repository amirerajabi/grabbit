# Privacy policy

This policy covers the Grabbit app and the Grabbit browser extension for Chrome, Microsoft Edge and Firefox.

## What the extension does with your data

The extension sends the address of a link or download you choose (or that it takes over from the browser), the page
it came from, and the cookies the browser holds for that address to the **Grabbit app running on your own computer**,
at `http://127.0.0.1:7310`. Grabbit uses the cookies only to download that file, so files behind a sign-in download
correctly.

The extension stores one setting in the browser: whether capturing downloads is turned on.

## What is not collected

- Nothing is sent to the developer or to any third party. There are no analytics, tracking or advertising.
- The extension does not read the pages you visit, except the links of a page when you choose "Download selected
  links" or "Download all links" with Grabbit.
- Nothing is sold or shared.

## The app

The Grabbit app downloads the files you add, from the servers they come from. It keeps your download list and settings
on your computer. It checks [GitHub Releases](https://github.com/amirerajabi/grabbit/releases) for new versions, which
you can turn off in Options → Updates.

Site logins and archive passwords you save are encrypted on your computer and sent only to the site they belong to.

The first time a feature needs a helper program, the app downloads it from that project's official GitHub releases and
checks its checksum: 7-Zip (extracting archives), yt-dlp (videos from web pages) and FFmpeg (joining video and audio).
Copies already installed on your computer are used instead where possible. yt-dlp contacts the video site you gave it,
and Grabbit checks GitHub for a newer yt-dlp at most once a day when you download a video.

## Contact

Questions: open an issue at https://github.com/amirerajabi/grabbit/issues.
