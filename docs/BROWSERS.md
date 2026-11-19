# Browser integration: installation, compatibility, updates and troubleshooting

## What can actually be detected

GetANNY checks executable locations and Windows App Paths registrations. Use **Refresh status** to scan again. Portable or nonstandard installations may need **Locate browser**. Detection uses executable paths and registry entries. The extension uses the browser cookie API for the specific download URL when the user enables it for that hostname.

Browsers do not provide an external trustworthy installed/enabled query to this application. Therefore:

- **Detected**: browser executable exists. Detection is a convenience for opening the management page; it no longer gates setup.
- **Direct bridge prepared**: a browser-specific extension folder and private per-user credential exist. This is **not installed**.
- **Native fallback registered**: a native manifest / current-user registry entry points to an executable launcher. This is **not connected** and is no longer required for the normal data path.
- **Connected and verified**: the extension completed an authenticated protocol-v2 hello over the direct loopback bridge and sends heartbeats. This proves it is enabled in a running browser session.
- **No handshake**: installed/enabled state is **unknown**. It could be absent, disabled, closed, misconfigured, or blocked.

Browser ID is supplied by the selected browser-targeted configuration; it is not a way to fingerprint browsers that deliberately mimic Chrome. Use the correct package / popup browser choice.

## Compatibility investigation

| Browser | Extension | Management page | Windows native-bootstrap lookup | Installation / update |
| --- | --- | --- | --- | --- |
| Helium | Chromium MV3, stable public key/ID | `chrome://extensions` | Chrome-compatible HKCU key, both x64 views | Load unpacked; reload the same folder. Windows Helium uses `chrome.exe` under `imput\Helium\Application`. |
| Google Chrome | Chromium MV3 (Chrome 116+) | `chrome://extensions` | Google key, both x64 views | Developer-mode Load unpacked. No signed CRX/store listing is supplied. |
| Chromium | Chromium MV3 | `chrome://extensions` | Chromium and Chrome-compatibility keys, both views | Load unpacked. Portable installs may need Locate browser. |
| Brave | Chromium MV3 | `brave://extensions` | Brave and Chrome-compatibility keys, both views | Load unpacked; Shields/site-access settings can affect page detection. |
| Mozilla Firefox | Separate MV2 background, Gecko ID and native permission | Firefox Add-ons | Mozilla key, both x64 views | Install from Firefox Add-ons and receive updates through Firefox. |
| Vivaldi | Chromium MV3 | `vivaldi://extensions` | Vivaldi and Chrome-compatibility keys, both views | Developer-mode Load unpacked; reload on update. |
| Opera | Chromium MV3 | `opera://extensions` | Opera and Chrome-compatibility keys, both views | Load unpacked; explicit extension/site access may be required. No Opera Add-ons listing is supplied. |
| Microsoft Edge | Chromium MV3 | `edge://extensions` | Edge and Chrome-compatibility keys, both views | Developer-mode Load unpacked; reload on update. |

Minimum MV3 Chrome version reflects native / service-worker and WebSocket support; the current release is targeted at current desktop browsers. Compatibility is not the same as successful testing in each branded browser. See [test matrix](TESTING.md).

Relevant upstream source reviewed during the audit:

- [Chromium native host lookup and executable launching](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/messaging/launch_context_win.cc)
- [Chromium native host manifest schema](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/messaging/native_messaging_host_manifest.cc) (no supported `args` field)
- [Helium native-host Chrome fallback patch](https://github.com/imputnet/helium/blob/main/patches/helium/core/scan-chrome-native-messaging-hosts.patch) (its explicit POSIX-only patch is **not** assumed to implement Windows support; standard Windows Chromium Chrome lookup is used)
- [Helium Windows branding / actual executable location](https://github.com/imputnet/helium-windows/blob/main/installer/helium.nsi)

Forks may change native-host lookup behavior. That no longer blocks a prepared extension: authenticated loopback WebSocket is primary, and native discovery is only bootstrap/cold-start fallback.

## Chromium-family setup (Helium, Chrome, Chromium, Brave, Vivaldi, Opera, Edge)

1. Install/start GetANNY, open **Browser integration**, and select the actual browser.
2. Click **Set up**. This writes a stable browser-specific folder and random private direct credential under current-user app data. It also repairs native bootstrap as a fallback; executable detection does not decide whether setup runs.
3. Click **Open extensions page**, or enter the management URL above manually. **Locate browser** is needed only to launch a nonstandard/portable executable, not to provision communication.
4. Enable **Developer mode**, click **Load unpacked**, and choose the exact folder displayed by GetANNY. Confirm the requested permissions and pin the toolbar icon. Browser approval remains explicit.
5. Open the GetANNY popup and click **Reconnect**. The expected status is **Direct bridge**. Both popup and desktop must show a verified connection; folder/registry existence alone is not success.
6. Start a supported HTTP(S) download or use **Download with GetANNY** from the context menu. The desktop queue applies your start and scheduling preferences. Once GetANNY completes a retained handoff, the extension clears the paused browser copy from the native download list.
7. For a video page choose **Analyze media in GetANNY**, use the popup's media action, or use the compact video overlay. Select a format and destination in Media Studio. The overlay's close button dismisses it for that video during the current page session. Drag its move handle to save a position for the current hostname, or use **Hide GetANNY on this site** to hide the overlay.

GetANNY prepares the extension folder from the installed Setup EXE. Generic ZIPs built from source can also connect through native bootstrap or the browser-specific recovery key.

### Download and cookie choices

In the 2.6.1 extension popup, expand **Browser download preferences** to turn automatic handoff off or keep automatic downloads from the current site in the browser. Explicit **Download with GetANNY** actions still work. **Include cookies for this download site** is off until enabled for the displayed hostname. Enter a direct file URL in the popup to select its download host when it differs from the tab's site. Earlier versions' global cookie toggle does not carry forward to the new site permissions. Check the extension version in GetANNY if these controls are missing from a store installation.

### Updating

Install the new desktop package, refresh the setup files for your browser, then choose **Reload** on the extensions page. Keep the existing unpacked folder path so the browser can reload it. The desktop connection lists the version reported during the last handshake.

## Manual acceptance on Windows

Use the standard installed Setup EXE. In GetANNY, select the browser under **Browser integration** and run **Set up**. In Chrome, open \`chrome://extensions\`. In Vivaldi, open \`vivaldi://extensions\`. Enable **Developer mode**, choose **Load unpacked**, and select the exact folder GetANNY shows. For Edge, use the same steps under \`edge://extensions\`. Keep each extension in its own browser-specific folder.

1. Open the extension from the browser toolbar and confirm **Connected · Secure local bridge**.
2. Start a small non-sensitive HTTP(S) file download through the browser. Confirm one completed file in GetANNY, compare it to the source with SHA-256, and check that the browser has no duplicate active download. Use a file large enough for the extension to pause it before it finishes.
3. Quit GetANNY, relaunch it, and reopen the toolbar popup. Repeat the transfer check. Test a full browser restart during a handoff as a separate case and record whether the browser entry and GetANNY queue reconcile.
4. Open an ordinary page with a playable, non-DRM video and play it. Check that the extension detects it and that sending it to Media Studio opens the correct item.
5. Record the browser version and the outcome of each step. Record any unexercised step as **UNVERIFIED**.

Hosted Windows CI may leave Chrome unverified when its native picker cannot be safely driven. A verified Vivaldi worker transfer confirms the bridge and output hash. The popup, reconnect, ordinary interception and content detection each require their own result.

## Firefox

Use the Firefox package only. The fixed Gecko ID is `getanny@getanny.app`; permissions include `nativeMessaging` and the manifest uses Firefox background scripts / `browser_action` rather than a Chromium service worker / `action`.

Regular installation: choose **Install from Firefox Add-ons** in GetANNY's **Browser integration** page, or install from the [GetANNY Firefox Add-ons listing](https://addons.mozilla.org/fr/firefox/addon/getanny-downlaod-manager/). Then complete Firefox setup in GetANNY and confirm that the extension connects.

Development install: **about:debugging → This Firefox → Load Temporary Add-on → manifest.json**. This bundled development install is temporary and Firefox removes it when Firefox restarts. The supplied ZIP is **not a signed XPI**; use the Firefox Add-ons listing for a regular install.

Updates: Firefox manages updates for add-ons installed from Firefox Add-ons. For a temporary development install, reload the add-on after replacing its files. Do not rename an unsigned ZIP to XPI and call it production signed.

## Direct bridge, native bootstrap and recovery

Host ID: `com.getanny.native`. Chromium extension ID: `oocncjjghijimkajhmdjcgdffkfojpbg` (derived from the checked-in **public** manifest key, not a signing private key). Firefox ID: `getanny@getanny.app`.

The bridge binds **only `127.0.0.1:29615`**. Protocol v2 uses separate random credentials for native bootstrap, manual recovery and every browser. It validates loopback Host/origin, binds a credential to the selected browser during hello, uses heartbeats/retry, and does not count a bare socket as connected. Websites and clients without a valid capability are rejected.

The prepared extension uses the direct credential immediately and automatically reconnects after service-worker/browser/desktop restart. Native Messaging is attempted only when no valid prepared/saved direct credential is available or direct connection fails long enough to require cold start.

On Windows, compiled `GetANNY.NativeHost.exe` reads its adjacent protected-user configuration and launches the installed Electron runtime in Node mode. No external Node installation and no unsupported manifest `args` field are used. The JavaScript broker frames messages with four-byte little-endian lengths, authenticates with its own native-only credential, and can return the calling browser's direct credential after an authenticated hello. Subsequent requests use WebSocket.

If both direct setup and native bootstrap fail, open **Need an alternative connection?** in the desktop. Reveal/copy the recovery key for the selected browser and paste it into the extension's **Connection & pairing** section. Save and reconnect. The key stays in your local user profile; never share or commit it. Generic release ZIPs and source-controlled files contain no real credential.

## Permissions and limitations

- `nativeMessaging`: cold-start/bootstrap the local adapter when direct credentials are unavailable; it is not the normal transfer path.
- `storage`: browser choice and that browser's local direct/recovery credential.
- `tabs`: current page context and per-tab detections.
- `contextMenus`: explicit link/media/page send actions.
- `downloads`: observe ordinary native downloads, pause them before handoff, resume a rejected/dismissed request, and cancel/erase the native history entry after GetANNY accepts ownership. GetANNY does not request the browser's delete-file operation.
- `cookies` + HTTP(S) host permissions: forward cookies applicable to the intercepted URL so authenticated direct downloads can continue in the desktop engine.
- `webRequest`: inspect response content types and provide HTML5 media detection/actions.
- No password access, browser profile editing, enterprise policies, forced extension installation, or silent extension updates.

The handoff includes the available final URL, filename, URL-specific cookies, referer and browser user agent. **Browser download APIs do not expose every original request header**, so identical arbitrary-header forwarding is not claimed. Short, completed or otherwise unpausable downloads stay in the native manager rather than risking two active copies. For a private window, enable the extension in the browser’s private-access settings. Automatic file handoff requires the extension to identify exactly one private cookie store for the request. An ambiguous handoff stays with the browser. The desktop keeps private job metadata and credentials in memory for that session and saves the finished file to the chosen destination. If a response is ambiguous after timeout/disconnection, the native copy remains paused until status reconciliation; a definitive rejection resumes it. Clean desktop shutdown resumes still-reviewed native transfers.

Blob URLs are not transferable files; the original page is analyzed instead. DRM is unsupported. Logged-in media / signed short-lived URLs may fail without website-specific authentication. Detection is limited to accessible media/network responses and supported pages, not a claim to extract every site.

## Troubleshooting

- **Host not found**: a prepared browser-specific folder should still connect directly. Select the right browser, click **Set up**, reload that exact unpacked folder, then Reconnect. For a generic ZIP, setup repairs native bootstrap across both registry views; recovery-key entry remains available.
- **Permission denied**: approve extension site access. GetANNY does not bypass your browser's security UI.
- **Credential rejected / wrong browser**: use the exact prepared folder for this browser, or copy the full current recovery key for the selected browser from the same Windows user. Credentials are deliberately browser-bound; do not reuse another browser/account's key.
- **No response**: start GetANNY, enable Browser integration in Settings, check `127.0.0.1:29615`, reload the extension and Reconnect. A listening port or registry key alone is not success; look for an authenticated direct hello in both UIs.
- **Worked before an upgrade/path change**: start the packaged app once to trigger repair, then reload the unpacked extension. Run `GetANNY.exe --setup-browser-hosts --quiet` for explicit repair and inspect `browser-setup-report.json`.
- **Queued but no file yet**: check download status, the queue concurrency limit, auto-start preference, and whether confirmation is awaiting review in the desktop app.
- **Browser download remains paused after a connection loss**: reopen GetANNY and the extension popup, then Reconnect. The extension reconciles the transfer ID before choosing desktop ownership or native resume. This pause is intentional duplicate protection, not a second active download.
- **No detected media**: restricted browser pages, inaccessible/DRM players and some dynamically fetched streams are not downloadable. Send the original supported media page to analysis. See the actual error if the extractor rejects it.
- **After uninstall**: remove the extension through the browser UI. Prepared files / native keys are cleaned where owned; personal profiles are never edited. Close browsers to release native-executable locks before uninstalling.
