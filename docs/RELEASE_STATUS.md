# GetANNY 2.2.4 release status

- Application binaries were built from source commit `16d694b7fabcd593c76b959009a3e6895d768bab`; this release includes a documentation-only follow-up.
- Local renderer and Windows x64 EXE, MSI and portable packages built successfully. All eight browser-extension ZIPs were generated.
- GitHub Actions run 41358016389 was cancelled at the owner's request. This release has not passed the Windows/browser verification workflow and is not test-certified.
- Windows binaries are unsigned. Verify the published SHA-256 checksums before running installers.
- Packaged runtime, torrent drag-and-drop and browser-extension handshakes were not manually retested for this build.

---

# GetANNY 2.2.1 release status

- Source commit: recorded in `Documentation/RELEASE_INFO.md` in the Windows bundle and linked Git tag.
- Local automated tests: not run for this UI and torrent-drop patch.
- Renderer production build and all eight browser extension package builds: completed locally.
- Windows EXE, MSI and portable packages: built locally with electron-builder.
- The Windows app package contains both browser-extension builds; standalone browser ZIPs remain included as a fallback. Browser extension installation and handshake were not manually retested in the packaged application.
- GitHub Actions Windows/browser verification is intentionally skipped at the owner's request. This release is not represented as passing those remote gates or as manually certified.
- Windows binaries are unsigned. Verify the supplied SHA-256 checksums and review `Documentation/START_HERE.md` before installation.
- Torrent drag and drop and close-to-tray behavior were not manually retested in the installed package.
