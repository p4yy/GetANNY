<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-horizontal-white.png">
    <img src="assets/brand/lockup-horizontal-black.png" alt="GetANNY" width="420">
  </picture>
</p>

<h1 align="center">GetANNY</h1>

<p align="center"><strong>A focused Windows download manager for files, media and browser downloads.</strong></p>

<p align="center">
  <a href="https://github.com/p4yy/GetANNY/releases/latest">Download for Windows</a>
  ·
  <a href="https://github.com/p4yy/GetANNY/releases">All releases</a>
  ·
  <a href="docs/INSTALL_WINDOWS.md">Installation guide</a>
  ·
  <a href="docs/BROWSERS.md">Browser setup</a>
</p>

GetANNY brings everyday downloads into one desktop workspace. Manage file transfers, inspect supported media, keep a searchable download history, and optionally connect your browser to GetANNY.

## See GetANNY in action

<p align="center">
  <img src="assets/demo/getanny-showcase.gif" alt="Animated preview of GetANNY's download manager, media studio, browser integration and settings" width="900">
</p>

<p align="center"><sub>The download library, media studio, browser setup and settings.</sub></p>

## Download GetANNY

<sub>Current release: **2.1.3** · Windows 10/11 · 64-bit</sub>

**[Open the official GetANNY 2.1.3 release page](https://github.com/p4yy/GetANNY/releases/tag/v2.1.3)**

Choose one Windows package:

| Package | Best for |
| --- | --- |
| [Setup (.exe)](https://github.com/p4yy/GetANNY/releases/download/v2.1.3/GetANNY%20Setup.exe) | Recommended for most users |
| [Windows Installer (.msi)](https://github.com/p4yy/GetANNY/releases/download/v2.1.3/GetANNY%20Setup.msi) | Managed or scripted Windows installation |
| [Portable (.exe)](https://github.com/p4yy/GetANNY/releases/download/v2.1.3/GetANNY%20Portable.exe) | Running from a writable folder without a standard install |

Also available: [complete Windows bundle](https://github.com/p4yy/GetANNY/releases/download/v2.1.3/GetANNY-v2.1.3-Windows.zip) · [SHA-256 checksums](https://github.com/p4yy/GetANNY/releases/download/v2.1.3/SHA256SUMS.txt).

**Important:** Use only one installer format. The current release binaries are unsigned. Windows may show a SmartScreen warning; review the release notes and verify the downloaded file against the published SHA-256 checksums before running it.

## What GetANNY does

### Download manager
- Download files over HTTP and HTTPS, including large files.
- Show transfer progress, speed and estimated time when the server provides enough information.
- Pause, resume, retry and manage multiple downloads.
- Use verified range requests when the server supports them.
- Keep download history in a local SQLite database.
- Search, filter, sort, inspect, open and reveal completed downloads.
- Never overwrites existing files or runs downloaded files automatically.

### Media downloads
- Inspect supported media pages with yt-dlp.
- Choose available video or audio formats and resolutions.
- Download subtitles and thumbnails when the source provides them.
- Use bundled FFmpeg for supported audio extraction and format processing.
- Track queued jobs, progress, processing and completed output.

Website support depends on the source site, authentication, region and changes to that site's delivery system. GetANNY does not bypass DRM or guarantee that every website can be downloaded.

### Browser integration
GetANNY can work with:
- Google Chrome and Chromium
- Microsoft Edge
- Brave
- Firefox
- Vivaldi
- Opera
- Helium

The browser add-on can hand supported downloads to the desktop app and provides media actions where available. Setup is guided from inside GetANNY. **Extensions are not silently installed or enabled**; you must approve browser installation and permissions yourself.

### Preferences and workspace
- Dark, light and alternative colour themes.
- Download limits, connection settings and concurrent jobs.
- Notifications, tray behaviour and startup preferences.
- Scheduled download start windows.
- Reduced-motion options and adjustable workspace density.

## Getting started

1. Download one of the Windows packages from the [official release page](https://github.com/p4yy/GetANNY/releases/tag/v2.1.3).
2. Install GetANNY, or run the portable build from a writable folder.
3. Open GetANNY and choose your download folder and preferences.
4. To use browser integration, open the in-app browser setup guide and follow the instructions for your browser.
5. Add a direct file URL or use a supported browser action to send a download to GetANNY.

See the [Windows installation guide](docs/INSTALL_WINDOWS.md) and [browser setup and troubleshooting guide](docs/BROWSERS.md) for details.

## Privacy and security

- Download history and preferences are stored locally in the app's user-data folder.
- Browser integration uses a local authenticated bridge; it is not intended to expose a remote service.
- Browser permissions and extension installation are presented for user approval.
- Downloaded files are not automatically executed.
- GetANNY does not claim to bypass DRM or browser/site access restrictions.

For security details, see [Architecture and security contracts](docs/ARCHITECTURE.md). To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## For developers

GetANNY is a Windows-first Electron application built with React, Vite and SQLite.

**Requirements**
- Node.js 22.22 or newer
- npm
- Windows build tools for native modules and Windows packaging

**Run locally**

```sh
npm ci
npm run prepare:tools
npm run build-extension
npm run dev
```

**Run tests and build**

```sh
npm test
npm audit --audit-level=high
npm run build:renderer
npm run build:win
```

See the project documentation for [architecture](docs/ARCHITECTURE.md), [testing](docs/TESTING.md), [Windows packaging](docs/INSTALL_WINDOWS.md), [browser integration](docs/BROWSERS.md), and [release notes](docs/RELEASE_NOTES.md).

## License

GetANNY is released under the [Apache License 2.0](LICENSE). Third-party tools and bundled components retain their respective licenses; see [third-party notices](docs/THIRD_PARTY.md).
