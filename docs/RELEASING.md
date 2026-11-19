# Release process

GetANNY uses semantic version tags in the form `vMAJOR.MINOR.PATCH`. The current application version is recorded in `package.json`; keep `package-lock.json` in sync when changing it.

## Prepare a release

1. Update the version, `CHANGELOG.md`, and `docs/RELEASE_NOTES.md`.
2. From a fresh Windows x64 checkout, run the setup steps in [CONTRIBUTING.md](../CONTRIBUTING.md), including `npm ci`, `npm run prepare:tools`, `npm test`, and `npm run build:win`.
3. The Windows workflow runs the desktop and browser handoff source checks, builds the NSIS Setup EXE, and verifies installation, same-version reinstallation, exercise, and uninstallation. A full-history secret scan must pass before the Windows build starts.
4. Review the actual Actions result and attached evidence. Do not publish if a required check fails or is missing.
5. To publish, make a release-approved commit whose message contains `GetANNY-Release-Approved:` (or use the workflow dispatch input `publish: true`). Publication remains gated behind every check. The workflow creates tag `v<package version>`, uploads the installer and evidence, verifies the uploaded assets, and then publishes the release.
6. Confirm the release title, tag, `GetANNY.Setup.exe`, `latest.yml` and checksums on GitHub. `latest.yml` must name the public installer exactly and carry the size and SHA-512 of those same bytes. The draft verifier checks this before publication.

To publish an already reviewed Windows installer, create a draft for the version that targets the source commit and upload the file as `GetANNY.Setup.exe`. Dispatch the release workflow with `publish: true` and the installer's `candidate_sha256`. The workflow checks the downloaded file against that digest, runs the installer tests on those bytes, and publishes the same file with its update metadata and checksums.

Record the actual Authenticode status, previous-version migration result, and browser versions tested. Deterministic bridge and extension tests are part of CI. Real installed-browser acceptance is a separate check. The app can open a stable GitHub release manually if updater metadata is unavailable.
