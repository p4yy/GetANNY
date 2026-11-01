# Packaged runtime validation

The renderer, extension, Windows package builds, 107 main tests, 13 packaging/tray tests, UI integration flow, and a 3.22 GB transfer-integrity check completed locally.

The packaged Windows GUI could not be launched in the build environment: Windows returned “Illegal System DLL Relocation” (process exit status 0x80000003). The same launch failure occurred with the stock Electron 45.1.0 executable, so this environment did not provide a usable packaged runtime check. The tray-close lifecycle and installed-app behavior therefore are not signed off by this build session.

The binaries are unsigned. GitHub Actions were not run at the owner's request. This release is not represented as having passed GitHub's automated verification gates.
