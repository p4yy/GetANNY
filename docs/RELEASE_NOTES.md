# GetANNY 2.5.0

- Added completed-file previews, file actions and cancellable SHA-256 comparison against a publisher-provided checksum.
- Added download health guidance for browser authentication, expired sources, disk access, scheduling and peer availability.
- Added optional quiet browser capture; foreground capture highlights the received download. Existing foreground raising remains enabled by default.
- Added per-file torrent priorities, rarest/sequential order and optional 5/15/60-minute sharing before saving, with Stop sharing and save in details. Default remains no sharing after completion. All torrents now offer the picker, including one- and two-file torrents.
- Added optional session-only queue completion actions: quit, sleep or shutdown after a cancellable 60-second countdown. Failed/cancelled/removed jobs disarm the action; new work delays it. The app shows the countdown in a global banner.
- Added grouped media formats with optional codec variants, preferred maximum resolution/container and audio/subtitle language preferences.
- Added a first-launch language, interface size, destination and browser setup panel.
- Added explicit smart paste for YouTube and other recognized media sites, magnet links and direct URLs. Normal text editing remains native; this does not monitor the background clipboard.
- Added theme-derived readable text, semantic status colors and visible focus states across dark/light themes. New installs use Evergreen; existing theme choices remain intact.
- Added restrained logo entrance and live-transfer breathing, paused while idle and disabled for reduced motion.
- Reads EXE product icons directly from executable resources instead of shell associations; invalidates the earlier icon cache. Downloaded programs are never executed to extract their icons.
- HTTP connection setup has a deadline, range probes retry without Range for additional incompatible responses, and retry scheduling respects Retry-After with capped exponential backoff.

Windows x64 local distribution. No Store package or GitHub publication. Executables are unsigned. Source was statically reviewed; no automated tests, app launch, sample downloads/exports or benchmarks were run. Playback, site compatibility, power actions, Arabic layouts and processing remain for owner testing. Preview support depends on Chromium codecs; use Open file for unsupported formats. Smart paste recognizes media hostnames, not every arbitrary web page. Sharing delays final publication and uses upload bandwidth.
