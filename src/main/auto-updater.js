const { autoUpdater } = require("electron-updater");
function configureAutoUpdater({ mainWindow, logger = console } = {}) {
  autoUpdater.autoDownload = false;
  let state = { status: "idle" };
  const publish = (next) => {
    state = next;
    mainWindow()?.webContents.send("update:status", next);
  };
  autoUpdater.on("checking-for-update", () =>
    publish({ status: "checking" }),
  );
  autoUpdater.on("update-available", (info) =>
    publish({
      status: "available",
      version: info.version,
    }),
  );
  autoUpdater.on("update-not-available", () => publish({ status: "current" }));
  autoUpdater.on("download-progress", (progress) =>
    publish({ status: "downloading", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    publish({ status: "downloaded", version: info.version }),
  );
  autoUpdater.on("error", (error) => {
    logger.error("Update check failed", error);
    publish({ status: "error" });
  });
  return {
    getState: () => state,
    check: () => autoUpdater.checkForUpdates(),
    download: () => autoUpdater.downloadUpdate(),
    install: () => autoUpdater.quitAndInstall(),
  };
}
module.exports = { configureAutoUpdater };
