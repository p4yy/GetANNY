# Release process

GetANNY uses semantic version tags in the form `vMAJOR.MINOR.PATCH`. The current application version is recorded in `package.json`; keep `package-lock.json` in sync when changing it.

## Prepare a release

1. Update the version, `CHANGELOG.md`, and `docs/RELEASE_NOTES.md`.
2. From a fresh Windows x64 checkout, run the setup steps in [CONTRIBUTING.md](../CONTRIBUTING.md), including `npm ci`, `npm run prepare:tools`, `npm test`, and `npm run build:win`.
3. Push the candidate to `main`. The Windows workflow runs the source checks, builds the NSIS Setup EXE, and verifies installation, reinstallation, exercise, and uninstallation. A full-history secret scan must pass before the Windows build starts.
4. Review the actual Actions result and attached evidence. Do not publish if a required check fails or is missing.
5. To publish, make a release-approved commit whose message contains `GetANNY-Release-Approved:` (or use the workflow dispatch input `publish: true`). Publication remains gated behind every check. The workflow creates tag `v<package version>`, uploads the installer and evidence, verifies the uploaded assets, and then publishes the release.
6. Confirm the release title, tag, installer asset, and checksum on GitHub. Never replace an existing release or tag.

The Windows Setup EXE is unsigned. Browser extension automation is not included in the Windows workflow; describe manual browser testing separately and do not present it as an automated check.
