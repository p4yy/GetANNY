// A downloaded .torrent is metadata to inspect, not an active torrent transfer.
export function isCompletedTorrentFile(item) {
  return item?.status === "completed" &&
    item.kind !== "torrent" &&
    typeof item.filename === "string" &&
    /\.torrent$/i.test(item.filename.trim()) &&
    typeof item.filePath === "string" &&
    /\.torrent$/i.test(item.filePath.trim()) &&
    (/^[A-Za-z]:[\\/]/.test(item.filePath) ||
      item.filePath.startsWith("/") ||
      /^\\\\[^\\]+\\[^\\]+\\/.test(item.filePath));
}

export function openCompletedTorrent(item, ui) {
  if (!isCompletedTorrentFile(item)) return false;
  // Importing inspects the metadata and selects files. Starting the torrent
  // remains an explicit user choice in the existing Add Torrent dialog.
  ui.setActiveTab("torrent");
  ui.setAddModal({
    torrent: true,
    torrentUrl: item.filePath,
    autoInspectTorrent: true,
    sourceTorrentDownloadId: item.id,
    sourcePage: item.sourcePage || item.browserPage || undefined,
  });
  return true;
}
