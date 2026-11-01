# GetANNY 2.2.0 release status

- Source commit: recorded in `Documentation/RELEASE_INFO.md` in the Windows bundle and linked Git tag.
- Local automated tests: the full suite did not finish. The network-enabled run passed browser and download coverage before later media tests stopped producing output; no complete test count is claimed.
- Renderer production build and all eight browser extension package builds: completed locally.
- Windows EXE, MSI and portable packages: built locally with electron-builder.
- GitHub Actions Windows/browser verification was intentionally skipped at the owner's request. This release is not represented as passing those remote gates or as manually certified.
- Windows binaries are unsigned. Verify the supplied SHA-256 checksums and review `Documentation/START_HERE.md` before installation.
- Installed-app close-to-tray behavior was not manually retested in this build.
