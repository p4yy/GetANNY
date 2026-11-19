const releaseBase = "https://github.com/p4yy/GetANNY/releases";
const releaseApi = "https://api.github.com/repos/p4yy/GetANNY/releases/latest";

function compareVersions(candidate, current) {
  const parse = (value) => {
    const match =
      /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        String(value || "").trim(),
      );
    return match
      ? {
          numbers: match.slice(1, 4).map(Number),
          prerelease: match[4] ? match[4].split(".") : null,
        }
      : null;
  };
  const next = parse(candidate);
  const installed = parse(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index++) {
    if (next.numbers[index] !== installed.numbers[index])
      return next.numbers[index] > installed.numbers[index];
  }
  if (!next.prerelease) return !!installed.prerelease;
  if (!installed.prerelease) return false;
  for (
    let index = 0;
    index < Math.max(next.prerelease.length, installed.prerelease.length);
    index++
  ) {
    const left = next.prerelease[index];
    const right = installed.prerelease[index];
    if (left === undefined) return false;
    if (right === undefined) return true;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null)
      return leftNumber > rightNumber;
    if (leftNumber !== null) return false;
    if (rightNumber !== null) return true;
    return left.localeCompare(right) > 0;
  }
  return false;
}

function configureAutoUpdater({
  mainWindow = () => null,
  currentVersion,
  fetchAsset = globalThis.fetch,
  openRelease,
  logger = console,
  updater,
} = {}) {
  updater ||= require("electron-updater").autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  let state = { status: "idle" };
  let releasePage = null;
  let availabilityPromise = Promise.resolve();
  const publish = (next) => {
    state = next;
    mainWindow()?.webContents?.send("update:status", next);
  };
  updater.on("checking-for-update", () => publish({ status: "checking" }));
  updater.on("update-available", (info) => {
    availabilityPromise = (async () => {
      if (!compareVersions(info?.version, currentVersion)) {
        publish({ status: "current" });
        return;
      }
      const asset = info?.files?.find((file) => typeof file?.url === "string");
      if (
        !asset ||
        !/getanny.*\.exe$/i.test(asset.url) ||
        typeof fetchAsset !== "function"
      ) {
        publish({ status: "unavailable" });
        return;
      }
      try {
        const version = String(info.version).replace(/^v/, "");
        const url = new URL(
          asset.url,
          `${releaseBase}/download/v${version}/`,
        );
        if (
          url.origin !== "https://github.com" ||
          !url.pathname.startsWith(`/p4yy/GetANNY/releases/download/v${version}/`)
        ) {
          publish({ status: "unavailable" });
          return;
        }
        const response = await fetchAsset(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(8000),
        });
        if (!response?.ok) {
          publish({ status: "unavailable" });
          return;
        }
        publish({ status: "available", version: info.version });
      } catch (error) {
        logger.warn(
          "Update asset verification failed:",
          error?.message || error,
        );
        publish({ status: "unavailable" });
      }
    })();
  });
  updater.on("update-not-available", () => publish({ status: "current" }));
  updater.on("download-progress", (progress) =>
    publish({ status: "downloading", percent: Math.round(progress.percent) }),
  );
  updater.on("update-downloaded", (info) =>
    publish({ status: "downloaded", version: info.version }),
  );
  updater.on("error", (error) => {
    logger.warn("Update check unavailable:", error?.message || error);
    publish({ status: "unavailable" });
  });
  async function checkPublishedRelease() {
    if (typeof openRelease !== "function" || typeof fetchAsset !== "function")
      return;
    try {
      const response = await fetchAsset(releaseApi, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return;
      const release = await response.json();
      const tag = release.tag_name;
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag))
        return;
      const version = tag.slice(1);
      if (!compareVersions(version, currentVersion)) {
        publish({ status: "current" });
        return;
      }
      if (
        !Array.isArray(release.assets) ||
        !release.assets.some(
          (asset) => asset?.state === "uploaded" && /^getanny[ .-]setup\.exe$/i.test(asset.name),
        )
      )
        return;
      releasePage = `${releaseBase}/tag/${tag}`;
      publish({ status: "available", version, manual: true });
    } catch (error) {
      logger.warn("GitHub release check unavailable:", error?.message || error);
    }
  }
  let checking = false;
  return {
    getState: () => state,
    check: async () => {
      if (checking) return state;
      checking = true;
      releasePage = null;
      publish({ status: "checking" });
      try {
        const result = await updater.checkForUpdates();
        const info = result?.updateInfo;
        if (
          result?.isUpdateAvailable ||
          (info && compareVersions(info.version, currentVersion))
        )
          await availabilityPromise;
        if (
          (info && !compareVersions(info.version, currentVersion)) ||
          result?.isUpdateAvailable === false
        )
          publish({ status: "current" });
      } catch (error) {
        logger.warn("Update check unavailable:", error?.message || error);
        publish({ status: "unavailable" });
      }
      try {
        if (state.status === "checking") publish({ status: "unavailable" });
        if (state.status === "unavailable") await checkPublishedRelease();
        return state;
      } finally {
        checking = false;
      }
    },
    download: () => (releasePage ? openRelease(releasePage) : updater.downloadUpdate()),
    install: () => updater.quitAndInstall(),
  };
}
module.exports = { compareVersions, configureAutoUpdater };
