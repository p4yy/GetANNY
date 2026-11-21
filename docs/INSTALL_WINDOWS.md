# Windows installation, development and release

## Install the desktop app

GetANNY currently distributes its official Windows **Setup EXE** through [GitHub Releases](https://github.com/p4yy/GetANNY/releases/latest).

1. Download `GetANNY.Setup.exe` and the matching `SHA256SUMS.txt` from the same release.
2. In PowerShell, run `Get-FileHash '.\GetANNY.Setup.exe' -Algorithm SHA256` and compare the result with the published checksum. Do not run the file if it does not match.
3. Launch the installer. Choose the installation folder and desktop-shortcut preference.
4. Open GetANNY from the Start Menu or desktop shortcut.
5. Choose the download folder and review the settings before starting transfers.

The user-facing Setup EXE is the dark WPF shell with the supplied animated GetANNY mark. It verifies and launches the original NSIS engine embedded inside it. NSIS remains responsible for installing application files, shortcuts, registration and the matching uninstaller shell.

The installer is unsigned unless the release's Authenticode evidence says otherwise. A SmartScreen warning can therefore appear. A logo or icon is not a code signature.

## Browser integration

Open **Browser integration** in GetANNY, select the browser, and choose **Set up**. The installer normally prepares the direct connection already; running setup again is a safe repair step.

For Chromium-family browsers, approve the prepared extension through the browser's extensions page and choose **Load unpacked**. Firefox uses the Firefox Add-ons listing for a regular install; a temporary development add-on must be loaded again after Firefox restarts.

Follow [Browser integration and native messaging](NATIVE_MESSAGING.md) for the exact browser steps, permissions, connection model and troubleshooting. GetANNY does not force-install extensions, edit browser profiles or change enterprise policies.

## Upgrade, repair and uninstall

- Use the same Setup EXE installation channel and choose the existing install directory when upgrading.
- Settings and download history are stored in the current Windows user's GetANNY profile. They are preserved across normal upgrades and uninstalls.
- Downloaded files are stored in the destination you selected; uninstall does not delete them.
- The installer refreshes browser-specific extension files and native fallback registration. If a browser does not reconnect after an upgrade or install-path change, open GetANNY once, run **Browser integration → Set up**, reload the unpacked extension and reconnect.
- Remove the extension itself through each browser's own extensions UI. GetANNY does not manipulate personal browser profiles during uninstall.
- Close browsers before uninstalling so native-host executables are not held open.
- Same-version reinstall and uninstall checks are automated in Windows CI. A pristine consumer Windows VM, cross-version migration from older releases, and manual acceptance in every branded browser remain separate checks; a successful build alone does not certify them.

## Development prerequisites

For a Windows source build, use:

- Windows 10/11 x64
- Node.js 22.22 or newer and npm
- Visual Studio C++ Build Tools and Windows SDK
- Python for node-gyp when a native dependency needs source compilation
- .NET 10 SDK for the WPF setup shell
- Network access to the pinned upstream tool releases

The packaged application includes its own Electron/Node runtime and required media tools. End users do not need a separate Node.js or Python installation.

## Run the source tests

From the repository root:

```powershell
npm ci --ignore-scripts
npm run prepare:tools
npm run build-extension
npm test
npm audit --audit-level=high
npm run audit:locales -- --strict
```

For the renderer and setup UI:

```powershell
npm run build:renderer
npm run build:setup-ui
```

`npm test` is the complete Node test suite. The Windows Actions workflow runs it on code pushes, in addition to the install/reinstall/uninstall harness and secret scan. A test definition is not evidence of a pass: inspect the exact Actions run and its retained logs/reports.

## Build a local candidate

```powershell
npm run build:win:candidate
```

This produces a local candidate under `installer/artifacts/`. It is for development review, not an official release. The canonical branded installer build uses the Windows Actions workflow, which wraps the NSIS engine, captures the installer/uninstaller UI, exercises the installed application and retains evidence.

## Release process

The release workflow only publishes after its required checks pass and an explicit owner approval. It verifies the exact installer bytes, update metadata and SHA-256 checksums before making a release public. See the [latest Windows workflow](https://github.com/p4yy/GetANNY/actions/workflows/release.yml) for current results.

The current official workflow builds the NSIS Setup EXE. Do not infer that MSI or portable installers are available or tested.
