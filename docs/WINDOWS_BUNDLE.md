# GetANNY 2.2.1 — Windows release bundle

Everything needed to install, run and connect GetANNY on Windows 10/11 x64.

> **Unsigned build.** No code-signing certificate was available, so Windows SmartScreen may warn before running the installers or the portable executable. Verify the SHA-256 checksums in `Checksums/SHA256SUMS.txt` before running anything. An icon is not a signature.

## What is in this folder

| Folder               | Contents                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Installers`         | `GetANNY-2.2.1-Setup.exe` (NSIS, per-user) and `GetANNY-2.2.1-Setup.msi` (Windows Installer). Use **one**, not both.               |
| `Portable`           | `GetANNY-2.2.1-Portable.exe`, a single executable that runs from a writable folder.                                                 |
| `Browser_Extensions` | Manual-fallback extension ZIPs for Helium, Google Chrome, Chromium, Brave, Firefox, Vivaldi, Opera and Microsoft Edge. The app also contains the extension files. |
| `Setup_Helpers`      | `Setup-Browsers.ps1` / `.cmd` to re-run browser and native-host registration for an installed GetANNY, plus native-messaging notes. |
| `Documentation`      | Installation, browser integration, portable use, release notes, changelog, third-party notices and the Apache-2.0 licence.          |
| `Checksums`          | SHA-256 for every file in this bundle.                                                                                              |

## Install (recommended)

1. Verify checksums (below).
2. Run `Installers/GetANNY-2.2.1-Setup.exe` **or** `Installers/GetANNY-2.2.1-Setup.msi`.
3. Choose the installation folder if offered, and keep the Start Menu shortcut. A desktop shortcut is optional.
4. Launch GetANNY and open **Browser integration**.
5. Choose a detected browser and select **Install extension**. GetANNY prepares its bundled extension and native connection, then opens that browser's extensions manager. Follow the browser's developer-mode/load-unpacked prompt and approve the extension. GetANNY recognizes its handshake and verifies the connection after installation.

Browser security requires the user to confirm loading an unpacked extension. For Firefox, the bundled development extension is temporary and must be loaded again after Firefox restarts; permanent installation requires Mozilla signing. If guided setup does not work, use the matching ZIP in `Browser_Extensions` as the fallback.

If you already have an older GetANNY installed, installing 2.2.1 replaces the application files; download history and settings are preserved. Uninstalling does not delete your downloads or profile data unless you choose to remove them.

### Verify checksums

In PowerShell, from this folder:

```powershell
Get-FileHash '.\Installers\GetANNY Setup.exe' -Algorithm SHA256
Get-Content .\Checksums\SHA256SUMS.txt
```

The hash must match the corresponding line exactly. Repeat for any file you intend to run.

## Portable use

`Portable/GetANNY-2.2.1-Portable.exe` keeps its data beside the application in a writable location. Do not run it from a read-only folder or directly from the ZIP.

- A portable launch cannot register a persistent native-messaging host. Use the paired WebSocket connection while GetANNY is running, or install the EXE/MSI for permanent browser integration.
- See `Documentation/PORTABLE_WINDOWS.md` for details and limitations.

## Browser extensions

The extensions ship inside GetANNY. Use Browser integration → **Install extension** first; the ZIP set here remains as a manual fallback. All Chromium packages are unpacked developer-mode extensions, not store-signed CRX files. Firefox packages are unsigned development ZIPs and unload when Firefox restarts; permanent installation requires Mozilla signing.

1. Extract the ZIP for your browser to a permanent folder (do not delete it).
2. **Chromium family** (Helium, Chrome, Chromium, Brave, Vivaldi, Opera, Edge): open the browser's extensions page, enable Developer mode, choose **Load unpacked**, and select the extracted folder.
3. **Firefox**: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json` in the extracted folder.
4. Open the extension popup and choose **Reconnect**. A live handshake is the only proof of connection.
5. If native messaging is unavailable, copy the desktop pairing key from GetANNY → Browser integration into the extension's **Connection & pairing** panel.

Each ZIP contains its own `INSTALL.md` with the exact steps for that browser. Permissions and compatibility notes are in `Documentation/BROWSERS.md`. There is no store update service configured for these packages.

### Re-run browser setup

For an installed copy, `Setup_Helpers/Setup-Browsers.cmd` asks for the path to `GetANNY.exe` and re-registers native hosts for the current user. Alternatively run the same setup from GetANNY → Browser integration.

## Branding

The eagle/shield mark and GetANNY wordmark in the application, installers, shortcuts, notifications, tray and extensions are the supplied original artwork. Only colour, transparency, proportional scaling and padding were adjusted; the shapes, geometry, proportions and lettering are unchanged. The default **Obsidian** theme and its **Porcelain** light counterpart are built from the logo's black-and-white identity.

## Troubleshooting

- **SmartScreen warning:** expected for an unsigned build. Confirm the checksum, then choose _More info → Run anyway_ only if you trust the source.
- **Windows keeps an old taskbar or shortcut icon:** Windows caches shell icons. Sign out and back in, or restart Explorer, and unpin/re-pin any old shortcut so the new 2.2.1 icon is used.
- **Browser does not connect:** open GetANNY → Browser integration, run Set up again, then reconnect from the extension popup. See `Documentation/BROWSERS.md`.
- **Antivirus flags the portable launcher:** portable Electron executables are frequently heuristically flagged. The installer editions are the supported distribution.

Release page: <https://github.com/p4yy/GetANNY/releases/tag/v2.2.1>
