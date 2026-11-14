const fs = require("node:fs");
const path = require("node:path");

function browserBridgeDirectory(userDataPath, platform = process.platform) {
  return path.join(
    userDataPath,
    platform === "win32" ? "GetANNY Browser Bridge" : "native-messaging",
  );
}

function desktopExitMarkerPath(userDataPath) {
  return path.join(browserBridgeDirectory(userDataPath), "desktop-exit.json");
}

function isDesktopExitMarked(markerPath) {
  return Boolean(markerPath && fs.existsSync(markerPath));
}

function markDesktopExited(markerPath) {
  if (!markerPath) return false;
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ closedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    return true;
  } catch {
    return false;
  }
}

function clearDesktopExitMarker(markerPath) {
  if (!markerPath) return false;
  try {
    fs.rmSync(markerPath, { force: true });
    if (path.basename(path.dirname(markerPath)) === "GetANNY Browser Bridge") {
      const legacyMarker = path.join(
        path.dirname(path.dirname(markerPath)),
        "native-messaging",
        "desktop-exit.json",
      );
      fs.rmSync(legacyMarker, { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  browserBridgeDirectory,
  desktopExitMarkerPath,
  isDesktopExitMarked,
  markDesktopExited,
  clearDesktopExitMarker,
};
