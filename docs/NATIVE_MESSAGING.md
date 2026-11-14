# Native messaging: bootstrap and cold-start fallback

Native Messaging is no longer GetANNY's normal browser data path. See [BROWSER_INTEGRATION_V2.md](BROWSER_INTEGRATION_V2.md) for the investigation and selected architecture.

The EXE and MSI installers provision a browser-specific authenticated loopback credential and stable extension folder for every supported browser. Once that prepared extension is approved/loaded, it connects directly to `127.0.0.1:29615` and automatically reconnects without registry discovery.

The installers include the **GetANNY Browser Bridge**. Windows identifies its executable, `GetANNY.NativeHost.exe`, as part of GetANNY and shows the same product version as the app. The installer registers it for two cases:

1. cold-start GetANNY when a generic/older extension cannot reach the desktop; and
2. securely bootstrap a generic extension with its browser-specific direct credential.

On Windows, the per-user helper and its manifest live in the `GetANNY Browser Bridge` folder under GetANNY app data. An upgrade re-registers the new path before removing the old helper files. The browser's protocol identifier remains `com.getanny.native` so existing extensions can still connect.

The launcher is a compiled C# executable because native-host manifests do not support an `args` field. It reads its adjacent per-user configuration, starts the installed Electron runtime in Node mode, relays standard native-message framing and authenticates to the loopback bridge with a credential that is distinct from every browser credential. No external Node.js installation is required.

Installer setup provisions all browsers and both Windows registry views; it is not gated on executable detection. Loading/enabling the extension still requires browser consent. GetANNY does not write browser profiles or enterprise policy.

Recovery command:

```powershell
& "C:\path\to\installed\GetANNY.exe" --setup-browser-hosts --quiet
```

Use the installed app, not the portable launcher. The standalone helper does not start SQLite, download engines or the bridge server, so it can run during install/repair while the desktop is open. Results are written to `browser-setup-report.json` under the current user's GetANNY app-data directory.

A generic release extension contains no secret. If both direct provisioning and native bootstrap are unavailable, reveal that browser's recovery key in **GetANNY → Browser integration**, paste it into **Connection & pairing**, and reconnect. Treat all bridge credentials as passwords; never share or commit them.
