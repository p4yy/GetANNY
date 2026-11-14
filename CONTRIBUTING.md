# Contributing

Thanks for helping improve GetANNY Download Manager. Please keep changes focused and preserve the existing browser consent and download safety behavior.

## Development setup

Windows 10/11 x64 is required for the installer build. Install Node.js 22.22 or newer, npm, Git, and the Windows build tools required by native dependencies. Then, from a fresh checkout:

```powershell
npm ci
npm run prepare:tools
npm test
npm run build:win
```

The build creates the NSIS Setup EXE in `dist/`. The Windows GitHub Actions workflow also checks the installer by installing, reinstalling, exercising, and uninstalling it. Review the workflow result and attached evidence for the exact checks completed; browser extension automation is currently excluded.

## Changes and pull requests

- Open an issue first for substantial behavior changes; small fixes can go directly to a pull request.
- Include a concise problem statement, the smallest relevant change, and actual test results.
- Add or update focused tests when behavior changes. Do not claim manual or automated checks that were not run.
- Keep dependencies locked. Do not commit generated builds, local settings, secrets, credentials, or downloaded personal data.
- Update `CHANGELOG.md` and release notes when a change affects users.

By contributing, you agree that your contribution is provided under the project license in `LICENSE`.
