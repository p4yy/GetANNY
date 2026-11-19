# Windows installation, build and release

## End-user installation

Requirements: Windows 10/11 x64, ordinary user account, writable destination/download folders, network access to your download sources. The standalone application includes its JavaScript runtime, native modules, yt-dlp, FFmpeg/ffprobe and native messaging launcher. Windows supplies .NET Framework 4.x for the small launcher; no separate Node.js or Python is needed.

1. Download **GetANNY Setup.exe** from the [latest GitHub release](https://github.com/p4yy/GetANNY/releases/latest). GitHub may save it as `GetANNY.Setup.exe`.
2. In PowerShell compare `Get-FileHash '.\GetANNY.Setup.exe' -Algorithm SHA256` with the checksum in `SHA256SUMS.txt` or in the release notes. Use the filename your browser saved.
3. Run the installer. Choose your install location and desktop-shortcut preference. Start Menu integration is included.
4. Open GetANNY → **Browser integration**, select your browser, and click **Set up** (the installer normally completed this already).
5. Follow [the browser installation steps](BROWSERS.md). Firefox uses Firefox Add-ons. Chromium-family browsers use the folder GetANNY prepares for the selected browser.
6. Open the extension popup and click **Reconnect**. Look for a verified connection in GetANNY.
7. Add a direct file URL, intercept a browser download, or analyze a supported media page and choose its format in Media studio.

Unsigned installers may show a Windows SmartScreen warning. The release evidence records the actual Authenticode status.

## Development test-build downloads

The Actions run retains a development artifact containing the Setup EXE, guide, SHA-256 sums and `BUILD_STATUS.txt`. It can be available while installed-app verification is still running. Downloading Actions artifacts may require GitHub sign-in.

## What has actually been measured

The release notes and linked Windows Actions run identify the source commit and verification scope. When included, `MEASURED_RESULTS.md` and `Windows-test-evidence.zip` record the individual results. See [historical test evidence](TESTING.md) for earlier builds.

## Scripted EXE installation

```powershell
Start-Process '.\GetANNY Setup.exe' -ArgumentList '/S','/currentuser','/D=C:\Apps\GetANNY' -Wait
```

Browser credentials and native fallback are provisioned in **HKCU/current-user app data** for the user running setup. On x64 Windows, native-host keys are written in both 64-bit and 32-bit registry views. Each user of a shared machine completes browser setup in their own account and approves extension installation in their browser.

The installer invokes a standalone provisioner to prepare each supported browser. Browser provisioning failures are written to `browser-setup-report.json` and can be repaired after installation. Packaged startup retries stale, missing or incomplete direct provisioning. GetANNY marks a connection verified after an authenticated extension handshake.

## Upgrade, repair and uninstall

- Close GetANNY before upgrading. Use the same installer format and installation directory.
- SQLite migrates the existing v1 table with an additive metadata column. Settings and history are retained. Older transfers without safe entity/segment metadata may need to restart; they are not blindly appended to different files.
- Browser-scoped credentials, prepared extension files and native fallback registration are refreshed. A version/install-path marker triggers automatic repair on the next packaged start if installer setup was stale. Reload unpacked extensions on the browser extensions page to apply updated scripts. Firefox temporary add-ons must be loaded again after browser restart.
- Uninstall from Windows Settings → Apps or run the EXE uninstaller.
- Native-host registrations owned by this application and prepared connection files are removed. Settings/history/downloaded files are preserved intentionally. Close browsers first so native executables are not locked.
- Remove the unpacked browser add-on through each browser's UI. GetANNY cannot and does not manipulate personal browser profiles during uninstall.
- Same-version reinstall and restart preservation are automated in CI. Cross-version upgrade from the old v1 EXE, interactive UI choices, locked-browser uninstallation, and a pristine Windows VM are separate manual gates, not implied by a successful build.

## Build from source on Windows

Node 22.22+, npm, Visual Studio C++ build tools, Python for node-gyp, Windows SDK, and .NET Framework C# compiler are build prerequisites (not end-user prerequisites).

```powershell
npm ci --ignore-scripts
npm rebuild node-datachannel
npm run prepare:tools
npm run build-extension
npm test
npm audit --audit-level=high
npm run build:renderer
npm run build:win
```

The locked SQLite 13 dependency includes a Windows x64 N-API prebuild shared by Node and Electron; no legacy ABI swap is required. C++/Python tools are used only if a native dependency needs source compilation.

The output is `dist/GetANNY Setup.exe`. Missing tools, mismatched pinned binary hashes or missing extension/renderer resources fail packaging. Generated binaries are ignored by Git.

For authorized signing, supply `CSC_LINK` and `CSC_KEY_PASSWORD` in the build environment / GitHub Secrets. Never put certificates or passwords into source control. CI records the real signature status. Without signing credentials, deliver unsigned binaries and disclose that limitation.

## Test installed packages

The Windows CI workflow runs `scripts/windows/test-installers.ps1` after generating real packages. Diagnostic mode `GetANNY.exe --self-test --test-user-data <isolated-folder> --report <file.json>` exercises the installed application rather than development files. It writes real files, temporarily registers a test native host for the current user, and then unregisters it. Use it only in an isolated test account; rerun normal browser setup afterward if necessary.

The installer harness covers the packaged renderer and bridge, transfers, restart, same-version reinstall and uninstall. CI also runs deterministic browser handoff tests. For real browser acceptance and cross-version migration, see [browser testing](BROWSERS.md#manual-acceptance-on-windows) and the evidence for the exact release.

## Releasing

See [the release process](RELEASING.md) for current verification steps, update metadata and published assets.
