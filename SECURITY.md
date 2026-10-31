# Security Policy

## Reporting a vulnerability

Please do not publish credentials, exploit details, or an unpatched vulnerability in a public issue.

Use GitHub's **Private vulnerability reporting** feature on this repository, if it is enabled, to send the maintainer a private report. Include the affected version, the impact, and clear reproduction steps where possible.

If private vulnerability reporting is unavailable, contact the repository owner privately through GitHub before disclosing the issue publicly.

## Supported versions

Security fixes are assessed against the latest published release. Older releases may not receive fixes.

## Handling credentials

Do not commit passwords, access tokens, private keys, signing certificates, browser profiles, or local application data. If a credential is exposed, revoke or rotate it immediately; deleting it from the latest commit is not sufficient because Git history and release artifacts may retain copies.
