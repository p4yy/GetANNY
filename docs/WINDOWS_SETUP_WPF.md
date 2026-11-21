# Windows setup shell (local candidate)

The Windows setup UI is a self-contained .NET 10 WPF shell around the existing
electron-builder NSIS engine. The official Windows build appends the original
NSIS engine to the WPF executable with scripts/windows/wrap-installer-release.js,
so the black GetANNY shell is the actual installer users launch. NSIS remains
responsible for installation, registration, shortcuts, upgrades and application-file removal. The WPF shell
extracts the appended NSIS payload after checking its SHA-256, then forwards the
same silent switches used by GetANNY's updater.

The same WPF executable, including the original animated GetANNY logo, is copied
into an installation as `GetANNY Uninstall.exe`. The NSIS hook points the existing
Add/Remove Programs entry at that shell, which delegates silent and upgrade
invocations to the installed NSIS uninstaller. The interactive uninstall keeps
the same dark visual language and animated logo on its confirmation, progress and
completion screens. An
interactive uninstall keeps user data by default. Opting into data removal shows
the exact profile paths and a second confirmation; only those known GetANNY
profiles can be removed. Downloaded files and the chosen installation directory
are never recursively removed by the shell.

## Build locally

Requirements: Windows x64, Node dependencies already installed, and the .NET 10
SDK. The build scripts do not fetch fonts or contact GitHub.

```powershell
npm run build:win:candidate
```

The output is deliberately separate from the existing installer:

- `installer/artifacts/GetANNY Setup - Local Candidate.exe`
- `installer/artifacts/GetANNY Uninstall.exe` (the self-contained shell placed
  into installed builds)
- `installer/artifacts/local-candidate-report.json`

The candidate is unsigned unless it is signed later through the established
release process. The normal `dist/GetANNY Setup.exe`, release metadata and
GitHub workflows are not changed by this local candidate build.

## Visual capture

The setup shell supports `--capture <directory>` and writes all installer and
uninstaller pages at 100%, 125%, 150% and 200% scale. The capture mode performs
no install and does not modify the user's GetANNY profile.
