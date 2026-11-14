# GetANNY Download Manager 2.6.0

## Highlights

- Added a safe fallback for producing the one-time welcome animation when the embedded legacy motion clip is invalid.
- Kept the animation scoped to the first-run welcome view; it does not leave an idle video decoder running.
- Preserved the tested Windows flows for browser connection, supported media, torrents, settings, and download-folder selection.

## Windows package

The official asset is the unsigned 64-bit Windows Setup EXE. The release workflow publishes measured build and install/reinstall/uninstall results, checksums, and verification evidence alongside the installer. Browser extension automation is not part of that workflow; the owner manually tested the extension on Windows.

The installer is unsigned and may display a Windows SmartScreen warning. The app does not install browser extensions silently.
