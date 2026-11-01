# GetANNY 2.2.0 — Capture, playlists and smoother libraries

GetANNY 2.2.0 adds faster ways to capture downloads, playlist extraction, and optional feedback while keeping the existing desktop design, themes, translations and browser handoff flow.

## Download capture

- Drop a supported link, magnet, or `.torrent` file anywhere in the app. Direct links open the New download dialog; supported media pages open Media Studio; torrents open the torrent flow.
- Paste clipboard contents from download-library empty states. Optional clipboard monitoring checks text once a second and shows a five-second capture prompt; it is off by default.
- HTTP `.torrent` links can be added alongside local torrent files and magnet links.

## Media playlists

- Media Studio can list up to 1,000 playlist entries, select or invert selections, and queue selected videos individually.
- Playlist output is virtualized. Quality selection prefers MP4 formats at or below the chosen resolution; items with no matching MP4 are skipped and reported.
- The existing single-media analysis and download flow remains available.

## Session cookie handling

- The browser popup has an opt-in **Include site cookies** control, off by default. The extension asks the browser only for cookies matching the specific target URL.
- Session and authorization headers are held in memory for the transfer and are excluded from SQLite headers/metadata, renderer download events, and application logs. Redirects to another origin strip those headers.
- Sensitive headers are discarded on completion, failure, cancellation, or shutdown. An interrupted transfer cannot silently resume with an expired session; it reports that the download must be refreshed from the browser.
- JavaScript runtimes cannot promise physical zeroing of immutable string copies, so the guarantee is that GetANNY drops its references and never intentionally writes the values to disk or logs.

## Performance, status and sound

- Long download and playlist lists render through a measured variable-height window rather than mounting every row.
- The footer updates once per second and opens Active downloads when clicked. Torrent upload speed is shown when available.
- A bundled soft chime can play after successful completion, with an enable switch, volume slider and preview in Settings. It is enabled by default and throttled to one play per two seconds.
- The secondary text tokens in all 12 themes were checked against the app surfaces; the muted text contrast minimum is 4.8:1 in the tested surface set.
- Major workspace panels have local error boundaries so one renderer failure does not take down the shell.

## Verification and distribution

See `RELEASE_STATUS.md` for what was verified. GitHub Actions Windows/browser tests were skipped at the owner's request. The binaries are unsigned; check SHA-256 values before running them. The release contains EXE, MSI, portable, eight browser extension ZIPs and a complete Windows bundle.
