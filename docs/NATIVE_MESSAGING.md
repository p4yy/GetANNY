# Browser integration and native messaging

## Connection model

Native Messaging is a bootstrap and cold-start fallback, not GetANNY's normal browser data path. The primary transport is an authenticated WebSocket bound only to `127.0.0.1:29615`.

A prepared extension receives its own browser-scoped 256-bit credential and stable folder under the current Windows user's GetANNY app data. It connects directly and reconnects after browser, service-worker or desktop restarts. A generic release ZIP contains no real credential; it can use the native adapter to bootstrap the correct browser credential or use the explicit recovery key.

The Windows native host ID is `com.getanny.native`. Its compiled `GetANNY.NativeHost.exe` launcher starts the installed Electron runtime in Node mode and relays standard four-byte little-endian Native Messaging frames. The launcher has a separate native-only credential. Native host manifests contain the executable path, stdio type and extension allowlist; they do not rely on an unsupported `args` field.

A connection is considered verified only after credential authentication, a protocol-v2 extension hello and live heartbeat. A detected browser executable, prepared folder, registry entry or open socket alone does not prove the extension is installed or connected.

## Supported browser targets

| Browser | Extension package | Management page |
| --- | --- | --- |
| Helium | Chromium Manifest V3 | `chrome://extensions` |
| Google Chrome | Chromium Manifest V3 (Chrome 116+) | `chrome://extensions` |
| Chromium | Chromium Manifest V3 | `chrome://extensions` |
| Brave | Chromium Manifest V3 | `brave://extensions` |
| Vivaldi | Chromium Manifest V3 | `vivaldi://extensions` |
| Opera | Chromium Manifest V3 | `opera://extensions` |
| Microsoft Edge | Chromium Manifest V3 | `edge://extensions` |
| Mozilla Firefox | Separate Firefox package / Gecko ID | `about:addons` |

These are supported provisioning targets, not a claim that every browser version has passed real-world acceptance. Check the exact Windows workflow and manual test evidence before treating a browser as certified.

## Chromium-family setup

1. Install and start GetANNY. Open **Browser integration** and select the actual browser.
2. Choose **Set up**. GetANNY prepares a stable browser-specific folder and private direct credential. Native Messaging is registered as a bootstrap/cold-start fallback.
3. Open the browser management page in the table above.
4. Enable **Developer mode**, choose **Load unpacked**, and select the exact folder shown by GetANNY. Approve the browser's requested permissions and pin the toolbar icon if desired.
5. Open the GetANNY extension popup and choose **Reconnect**.
6. Confirm that both the popup and desktop show a verified connection. A prepared folder or registry entry is not enough.
7. Test with a small non-sensitive file download before relying on browser handoff.

Browser approval remains an explicit user action. Portable or nonstandard browser installations may need **Locate browser** to open the correct management page; detection does not gate provisioning.

## Firefox

For normal use, install the [GetANNY Firefox add-on](https://addons.mozilla.org/fr/firefox/addon/getanny-downlaod-manager/) and complete setup in GetANNY → Browser integration.

For development, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the prepared `manifest.json`. A temporary add-on is removed when Firefox restarts and must be loaded again. The development ZIP is not a signed XPI; do not rename it and describe it as a signed release.

## Cookies, permissions and privacy

Cookie forwarding is enabled by default for matching HTTP(S) download hosts to support authenticated downloads. The popup's Cookies control can opt out for an individual site. GetANNY reads cookies for the specific target URL and sends them over the authenticated local connection; the desktop may include them in the request to that destination website. Cookie values are not stored as a per-site preference and are not sent to a developer-operated analytics service.

The extension permissions support these functions:

- `nativeMessaging`: bootstrap/cold-start fallback.
- `storage`: browser preferences and the browser-specific local credential.
- `tabs`: active page context and per-tab detections.
- `contextMenus`: explicit link, media and page actions.
- `downloads`: pause/reconcile browser-owned transfers and remove the matching native history entry after GetANNY accepts ownership. The extension does not request the browser's delete-file operation.
- `cookies` and HTTP(S) host access: optional per-site cookie handoff and supported media inspection.
- `webRequest`: inspect response types for media detection.

The extension does not read website passwords, modify browser profiles, change enterprise policies or silently install/update itself. The desktop bridge rejects website origins and clients without a valid capability.

## Handoff limits

- Browser APIs do not expose every original request header. GetANNY forwards only the available URL, filename, referer, user-agent and URL-matching cookies; it does not claim arbitrary-header parity.
- Short, completed or otherwise unpausable downloads stay in the browser to avoid duplicate transfers.
- An ambiguous handoff stays paused until transfer-ID reconciliation proves which side owns it.
- Private-window downloads require the browser to allow the extension in private mode and expose one unambiguous private cookie store.
- Blob URLs are not transferable files; the original page may be analyzed instead. DRM and inaccessible protected streams are unsupported.
- Some websites use short-lived URLs or authentication flows that cannot be resumed outside the original browser session.

## Troubleshooting

- **No connection:** start GetANNY, confirm Browser integration is enabled, run **Set up**, reload the exact prepared extension folder and choose **Reconnect**.
- **Credential rejected:** select the correct browser and prepared folder. Credentials are deliberately browser-bound; do not reuse another browser's key.
- **Generic ZIP cannot connect:** run browser setup to repair Native Messaging bootstrap, or reveal the recovery key for that browser in GetANNY and enter it in **Connection & pairing**. Never share the key.
- **No response:** check that the desktop is running and that the local bridge is listening on `127.0.0.1:29615`. A port alone is not proof; both UIs must show a verified hello.
- **Browser handoff remains paused:** reopen GetANNY and the popup, reconnect, and let the transfer ID reconcile. This is duplicate protection.
- **No media detected:** send the original supported page to Media Studio. DRM, restricted pages and inaccessible media responses cannot be extracted.
- **After an upgrade:** start the packaged app once, run **Set up** if needed, then reload the extension. Firefox temporary add-ons must be loaded again after browser restart.

## Manual acceptance

For a real browser test, record the browser/version, confirm a verified handshake, transfer a small non-sensitive file, compare its SHA-256 with the source, restart GetANNY and reconnect, then repeat. Test a browser restart during a handoff separately. Mark any step not actually exercised as **UNVERIFIED**. Source tests and a prepared extension are not substitutes for real-browser acceptance.

For service boundaries, security contracts and transfer integrity, see [Architecture](ARCHITECTURE.md).
