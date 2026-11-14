// Diagnostics deliberately use an allowlist: raw errors, URLs, filenames,
// headers, settings paths and browser credentials never enter the export.
function diagnostics({ manager, tools, version }) {
  const counts = {};
  for (const item of manager.getAll()) {
    const key = `${["file", "media", "torrent"].includes(item.kind) ? item.kind : "other"}:${["queued", "paused", "connecting", "downloading", "processing", "completed", "failed", "cancelled", "retrying"].includes(item.status) ? item.status : "other"}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    schemaVersion: 1,
    version,
    platform: process.platform,
    architecture: process.arch,
    runtime: {
      electron: process.versions.electron || null,
      node: process.versions.node,
    },
    tools: { ffmpeg: !!tools.ffmpeg, ytdlp: !!tools.ytdlp },
    counts,
  };
}
module.exports = { diagnostics };
