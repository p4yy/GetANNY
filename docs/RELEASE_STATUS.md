# GetANNY 2.2.2 local build status

- Local renderer, extension and Windows EXE/MSI/portable builds completed; Cairo font and OFL license were verified inside the generated app archive.
- Local automated tests passed: 107 main tests, 13 packaging/tray tests, UI integration and a 3.22 GB transfer-integrity test.
- The packaged GUI could not launch in this environment: Windows reported “Illegal System DLL Relocation” (0x80000003); the stock Electron 45.1.0 executable failed the same way. Packaged tray-close behavior and installed-consumer browser integration remain unverified. See `PACKAGED_RUNTIME_STATUS.md`.
- GitHub Actions were not run at the owner's request. Windows binaries are unsigned; GPU utilization was not measured.

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
