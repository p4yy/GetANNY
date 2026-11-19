# GetANNY Browser Assistant Privacy Policy

Last updated: 19 November 2026

GetANNY Browser Assistant connects your browser to the GetANNY desktop application so you can send downloads and supported media pages to that application.

## Information the extension handles

When you use the extension, it may read the active page's address and title, supported media links, and download details such as a file URL and filename. It uses this information to identify and hand off the download you requested.

The extension does not read passwords that you type into websites.

Cookie forwarding is off until you enable **Include cookies for this download site** for the hostname displayed in the popup. GetANNY may read cookies for matching download URLs and forward them over the authenticated local connection to authorize that download. The desktop app may include those cookies in its download request to the selected website, which handles the request under its own privacy policy.

For an unfinished ordinary browser download, GetANNY can retain the supplied session headers in an encrypted local file for up to 12 hours so it can resume after a restart. It uses the operating system's credential protection and keeps the headers in memory when that protection is unavailable. The application excludes those headers from history, logs, and renderer events. It removes the encrypted session when the transfer completes, is cancelled, or the site rejects authentication.

The extension stores its settings and local pairing information in the browser's extension storage so it can remember your choices and reconnect to your desktop application. It does not send browsing information, pairing information, or download details to an analytics or advertising service.

## How information is used and shared

Information handled by the extension is used to provide the browser-to-desktop handoff you request. It is sent to the GetANNY desktop application running on your computer through an authenticated local connection. GetANNY does not sell this information or send it to a developer-operated server. The destination website receives the normal request needed to provide the file, including relevant site cookies only when cookie forwarding is enabled and required for the download.

## Your choices and deletion

In the extension popup you can turn off cookies for a specific site, turn off automatic handoff, or leave a site's ordinary downloads in the browser. Removing the extension clears its browser-stored settings and pairing information. Cancel an active handoff in GetANNY.

## Changes and contact

This policy will be updated if the extension's data handling changes. For privacy questions, contact the GetANNY project through [GitHub Issues](https://github.com/p4yy/GetANNY/issues).
