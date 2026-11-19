# Changelog

## 2.6.5 — 2026-11-19

- Gave the trim editor its own view with one set of download and close controls.
- Anchored the sidebar toggle and kept selected media formats visible when opening the format list.
- Synchronized transfer speeds, showed the source format while the output is undecided, and simplified Browser integration.
- Made the branded uninstaller recognize the current and legacy removal engine filenames.

## 2.6.4 — Local review build

- Added a collapsible sidebar with library and tools icons.
- Added space between Media Studio controls and Browser integration panels.
- Showed browser setup and live connection status while Windows finishes checking installed browsers.

## 2.6.3 — Local review build

- Kept download search, categories, sorting and relevant bulk actions together at desktop widths.
- Made codec and audio details easier to scan in Media Studio and kept the download button in the output panel when its settings scroll.
- Simplified browser setup, Settings and first-run setup.

## 2.6.2 — Local review build

- Added right-click video actions for YouTube, TikTok and Dribbble cards.
- Improved ChatGPT and Claude file handoffs and browser recovery for restricted downloads.
- Moved paused items into Paused and kept one browser connection indicator in the status bar.

## 2.6.1 — Local review build

- Added batch review for file, media and torrent links, with duplicate detection, type and priority controls, folder overrides, and per-link results.
- Added no-overwrite torrent finalization and save-only recovery. Optional sharing starts after files are available. The file picker can sort by size or select the main media file.
- Matched audio and subtitle preferences by language, added media format presets, and made subtitle rate limits recoverable. Trim exports can optionally continue without captions.
- Unified browser setup and added per-site browser capture and cookie controls.
- Fixed live transfer totals, format metadata, file-type destination routing, and dialog scrolling. HTTP transfers share adaptive connection budgets.
- Prepared release tooling to attach update metadata and checksums for the exact verified installer.

## 2.6.0 — 2026-11-14

- Added a safe fallback for generating the one-time welcome animation when the embedded legacy motion clip is invalid.
- Added a release workflow that gates publication on secret scanning, source checks, and Windows installer verification.
- Preserved owner-tested browser connection, media, torrent, settings, and download-folder behavior.

Earlier release history is in the [historical changelog](docs/CHANGELOG.md). See [release notes](docs/RELEASE_NOTES.md) for user-facing details and verification scope.
