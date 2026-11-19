const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Menu,
  Notification,
  nativeImage,
  clipboard,
  safeStorage,
  powerMonitor,
  net,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { setupIpcHandlers } = require("./ipc-handlers");
const { createTray } = require("./tray");
const {
  shouldKeepBackgroundProcess,
  shouldRevealOnActivation,
} = require("./tray-window");
const { createMenu } = require("./menu");
const {
  WindowsWakeSchedule,
  settingKeys: wakeSettingKeys,
} = require("./settings/WindowsWakeSchedule");
const { translate } = require("./translate");
const { Logger } = require("./utils/logger");
const { configureAutoUpdater } = require("./auto-updater");
const { validateUrl } = require("./engine/utils");
const {
  clearDesktopExitMarker,
  desktopExitMarkerPath,
  isDesktopExitMarked,
  markDesktopExited,
} = require("./browser-integration/DesktopExitMarker");
const log = new Logger("Main");
const traySelfTest = process.argv.includes("--tray-self-test");
let win,
  services,
  tray,
  windowCreating,
  exiting = false,
  hiddenToTray = false,
  shutdownFinished = false;
const selfTest = process.argv.includes("--self-test");
const scheduledLaunch = process.argv.includes("--scheduled-downloads");
if (selfTest) app.disableHardwareAcceleration();
const setupOnly = process.argv.includes("--setup-browser-hosts");
const unregisterOnly = process.argv.includes("--unregister-browser-hosts");
const testDataIndex = process.argv.indexOf("--test-user-data");
if (process.platform === "win32" && testDataIndex < 0)
  app.setAppUserModelId("com.getanny.app");
if (testDataIndex >= 0 && process.argv[testDataIndex + 1])
  app.setPath("userData", path.resolve(process.argv[testDataIndex + 1]));
function send(channel, data) {
  if (win && !win.isDestroyed()) {
    if (
      (!win.isVisible() || win.isMinimized()) &&
      ["download:progress", "downloads:changed"].includes(channel)
    )
      return;
    win.webContents.send(channel, data);
  }
}
function showWindow() {
  hiddenToTray = false;
  if (!win || win.isDestroyed()) {
    if (services && !windowCreating) {
      windowCreating = createWindow({ forceShow: true })
        .catch((error) => log.error("Window activation:", error))
        .finally(() => {
          windowCreating = null;
        });
    }
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

let handoffRaiseTimer;
let raisedWindow;
let originalAlwaysOnTop = false;
function releaseHandoffRaise() {
  clearTimeout(handoffRaiseTimer);
  handoffRaiseTimer = undefined;
  if (raisedWindow && !raisedWindow.isDestroyed())
    raisedWindow.setAlwaysOnTop(originalAlwaysOnTop);
  raisedWindow = null;
}
async function foregroundBrowserHandoff(request) {
  if (services?.settings.get("bringToFrontOnCapture") === false) {
    if (testDataIndex < 0 && Notification.isSupported()) {
      const notice = new Notification({
        title: "Sent to GetANNY",
        body:
          request?.kind === "media"
            ? "Open GetANNY to choose media quality."
            : "Your download was received.",
        silent: true,
      });
      notice.on("click", () => {
        showWindow();
        send("browser:handoff", {
          id: request?.downloadId,
          kind: request?.kind || "file",
        });
      });
      notice.show();
    }
    return;
  }
  showWindow();
  // Tray-window release can require a fresh renderer. Wait for it instead of
  // losing the handoff navigation/focus request during load.
  if (windowCreating) await windowCreating;
  const target = win;
  if (!target || target.isDestroyed()) return;
  releaseHandoffRaise();
  if (target.isMinimized()) target.restore();
  target.setSkipTaskbar(false);
  originalAlwaysOnTop = target.isAlwaysOnTop();
  raisedWindow = target;
  // A short raise makes an explicit browser handoff visible even when Windows
  // rejects an ordinary background focus request. Normal stacking is restored.
  target.setAlwaysOnTop(true);
  target.show();
  target.focus();
  if (!target.isFocused()) target.flashFrame(true);
  handoffRaiseTimer = setTimeout(releaseHandoffRaise, 650);
  handoffRaiseTimer.unref?.();
  send("browser:handoff", {
    id: request?.downloadId,
    kind: request?.kind || "file",
  });
}

function toggleWindow() {
  if (!win || win.isDestroyed() || !win.isVisible()) {
    showWindow();
    return;
  }
  win.hide();
  win.destroy();
}

function releaseUnusedMediaOnTrayIdle() {
  // No renderer remains. Clear heavyweight analysis metadata only once
  // the last transfer is inactive, including after pause/completion.
  // Torrent seeding remains active and is never interrupted.
  if (exiting || !hiddenToTray || !services || (win && !win.isDestroyed()))
    return;
  const busy = services.manager
    .getAll()
    .some((item) =>
      ["connecting", "downloading", "processing", "seeding"].includes(
        item.status,
      ),
    );
  if (!busy) services.mediaDetector.releaseIdleMetadata();
}
async function createWindow({ forceShow = false } = {}) {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    title: "GetANNY",
    icon: path.resolve(__dirname, "../../assets/icon.png"),
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      shell.openExternal(validateUrl(url));
    } catch (error) {
      log.warn(error.message);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      try {
        shell.openExternal(validateUrl(url));
      } catch {
        /* unsupported navigation */
      }
    }
  });
  win.on("maximize", () => send("window:state", { maximized: true }));
  win.on("unmaximize", () => send("window:state", { maximized: false }));
  win.on("focus", () => {
    if (win && !win.isDestroyed()) win.flashFrame(false);
  });
  win.on("hide", () => {
    releaseHandoffRaise();
    hiddenToTray = true;
  });
  win.on("show", () => {
    hiddenToTray = false;
  });
  win.on("close", (event) => {
    if (
      !exiting &&
      services.settings.get("closeToTray") &&
      tray &&
      (!selfTest || traySelfTest)
    ) {
      event.preventDefault();
      hiddenToTray = true;
      win.hide();
      win.destroy();
    }
  });
  win.on("closed", () => {
    releaseHandoffRaise();
    win = null;
    releaseUnusedMediaOnTrayIdle();
  });
  if (app.isPackaged || selfTest)
    await win.loadFile(
      path.resolve(__dirname, "../../dist-renderer/index.html"),
    );
  else await win.loadURL("http://127.0.0.1:5173");
  if (
    forceShow ||
    !services.settings.get("startMinimized") ||
    selfTest ||
    process.argv.includes("--from-browser")
  )
    win.show();
  else if (tray) win.hide();
  else {
    win.show();
    win.minimize();
  }
}
async function recordOperationStage(stage, detail = {}) {
  if (!setupOnly && !unregisterOnly) return;
  const index = process.argv.indexOf("--report");
  const report = index >= 0 ? process.argv[index + 1] : null;
  if (!report) return;
  const file = path.resolve(report);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        passed: stage === "complete",
        operation: setupOnly ? "setup" : "unregister",
        stage,
        date: new Date().toISOString(),
        ...detail,
      },
      null,
      2,
    ),
  );
}
async function init() {
  await recordOperationStage("init");
  const userDataPath = app.getPath("userData");
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.resolve(__dirname, "../../bin");
  const extensionPath = app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.resolve(__dirname, "../../dist-extension");

  // Installer helpers deliberately avoid the normal service graph. They must
  // still work while GetANNY already owns its SQLite database or bridge port.
  const wakeSchedule =
    process.platform === "win32" &&
    app.isPackaged &&
    !process.env.PORTABLE_EXECUTABLE_FILE &&
    testDataIndex < 0 &&
    !selfTest
      ? new WindowsWakeSchedule({ executable: process.execPath })
      : null;
  if (unregisterOnly) {
    await wakeSchedule
      ?.remove()
      .catch((error) =>
        log.warn("Could not remove scheduled downloads task:", error.message),
      );
    const {
      NativeMessagingHost,
    } = require("./browser-integration/NativeMessagingHost");
    const nativeMessagingHost = new NativeMessagingHost({
      userDataPath,
      appPath: process.execPath,
      isPackaged: app.isPackaged,
      binPath,
    });
    const result = await nativeMessagingHost.unregisterAll();
    await recordOperationStage("hosts-unregistered");
    await fs.rm(path.join(userDataPath, "extensions"), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 150,
    });
    await fs.rm(path.join(userDataPath, "browser-integration-state.json"), {
      force: true,
    });
    if (["win32", "darwin"].includes(process.platform))
      app.setLoginItemSettings({ openAtLogin: false });
    await fs.writeFile(
      path.join(userDataPath, "browser-uninstall-report.json"),
      JSON.stringify(
        {
          passed: result.removed,
          date: new Date().toISOString(),
          nativeFilesRemoved: result.removed,
          extensionFilesRemoved: true,
          errors: result.errors,
        },
        null,
        2,
      ),
    );
    await recordOperationStage("complete", { succeeded: result.removed });
    app.exit(result.removed ? 0 : 1);
    return;
  }
  if (setupOnly) {
    const {
      setupBrowserIntegration,
    } = require("./browser-integration/BrowserIntegrationSetup");
    const report = await setupBrowserIntegration({
      userDataPath,
      extensionPath,
      binPath,
      appPath: process.execPath,
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      onProgress: recordOperationStage,
    });
    await recordOperationStage("browsers-prepared", {
      browsers: report.results.length,
      directReady: report.directReady,
      nativeReady: report.nativeReady,
    });
    await recordOperationStage("complete", {
      succeeded: report.directReady,
      nativeReady: report.nativeReady,
    });
    app.exit(report.directReady ? 0 : 1);
    return;
  }

  const { createServices } = require("./services");
  services = await createServices({
    userDataPath,
    downloadPath: app.getPath("downloads"),
    binPath,
    extensionPath,
    appPath: process.execPath,
    isPackaged: app.isPackaged,
    nativeImage,
    safeStorage,
    getSystemIdleTime: () => powerMonitor.getSystemIdleTime(),
    logger: log,
    getFileIcon: app.getFileIcon.bind(app),
    port: selfTest ? 0 : 29615,
    startTransfers: true,
    onSettingChange: async (key, value) => {
      if (wakeSettingKeys.has(key) && wakeSchedule) {
        const updated = { ...services.settings.getAll(), [key]: value };
        try {
          await wakeSchedule.configure(updated);
        } catch (cause) {
          throw new Error(
            "Windows Task Scheduler could not update the download wake timer.",
            { cause },
          );
        }
      }
      if (key === "language" && process.platform === "darwin")
        createMenu({ mainWindow: () => win, language: value });
      if (key === "launchAtLogin") {
        if (!["win32", "darwin"].includes(process.platform) && value)
          throw new Error("Launch at login is supported on Windows and macOS.");
        if (["win32", "darwin"].includes(process.platform))
          app.setLoginItemSettings({
            openAtLogin: value,
            path: process.execPath,
          });
      }
    },
    onBrowserRequest: (request) => {
      foregroundBrowserHandoff(request).catch((error) =>
        log.warn("Browser handoff activation:", error.message),
      );
    },
  });
  if (
    !selfTest &&
    testDataIndex < 0 &&
    ["win32", "darwin"].includes(process.platform)
  )
    app.setLoginItemSettings({
      openAtLogin: services.settings.get("launchAtLogin"),
      path: process.execPath,
    });
  if (wakeSchedule && services.settings.get("scheduleWakeEnabled"))
    wakeSchedule
      .configure(services.settings.getAll())
      .catch((error) =>
        log.warn("Could not restore scheduled downloads task:", error.message),
      );
  powerMonitor.on("resume", () => services.manager.pump());
  services.events.on("event", send);
  services.events.on("event", (channel, data) => {
    if (
      channel === "download:complete" &&
      testDataIndex < 0 &&
      services.settings.get("notifications") &&
      Notification.isSupported() &&
      !selfTest
    ) {
      const item = services.manager.requireItem(data.id);
      const notification = new Notification({
        title: translate(
          services.settings.get("language"),
          "menu.downloadComplete",
        ),
        body: item.filename,
        icon: path.resolve(__dirname, "../../assets/icon.png"),
      });
      notification.on("click", showWindow);
      notification.show();
    }
  });
  let updater = null;
  if (
    app.isPackaged &&
    process.platform === "win32" &&
    (await fs
      .access(path.join(process.resourcesPath, "getanny-github-updates"))
      .then(() => true)
      .catch(() => false))
  ) {
    updater = configureAutoUpdater({
      mainWindow: () => win,
      currentVersion: app.getVersion(),
      fetchAsset: net.fetch.bind(net),
      openRelease: (url) => shell.openExternal(url),
      logger: log,
    });
  }
  setupIpcHandlers({
    ipcMain,
    services,
    desktop: {
      app,
      shell,
      dialog,
      clipboard,
      mainWindow: () => win,
      updater,
      scheduledWake: Boolean(wakeSchedule),
    },
  });
  services.manager.on("changed", releaseUnusedMediaOnTrayIdle);
  if (process.platform === "darwin")
    createMenu({
      mainWindow: () => win,
      language: services.settings.get("language"),
    });
  else Menu.setApplicationMenu(null);
  if (!selfTest || traySelfTest) {
    try {
      tray = createTray({
        mainWindow: () => win,
        app,
        iconPath: path.resolve(__dirname, "../../assets/tray-icon.png"),
        onShow: showWindow,
        onToggle: toggleWindow,
      });
    } catch (error) {
      log.warn("System tray unavailable:", error.message);
    }
  }
  if (
    (services.settings.get("startMinimized") || scheduledLaunch) &&
    tray &&
    !process.argv.includes("--from-browser") &&
    !selfTest
  )
    hiddenToTray = true;
  else await createWindow();
  // An install-path repair can inspect and rewrite several browser bridge
  // files. Run it after the first window is up so a healthy app launch never
  // waits behind optional integration maintenance.
  if (
    app.isPackaged &&
    !selfTest &&
    testDataIndex < 0 &&
    !process.env.PORTABLE_EXECUTABLE_FILE
  ) {
    const {
      setupBrowserIntegration,
      browserIntegrationNeedsRepair,
    } = require("./browser-integration/BrowserIntegrationSetup");
    void browserIntegrationNeedsRepair({
      userDataPath,
      version: app.getVersion(),
      appPath: process.execPath,
    })
      .then((needed) =>
        needed
          ? setupBrowserIntegration({
              userDataPath,
              extensionPath,
              binPath,
              appPath: process.execPath,
              isPackaged: true,
              version: app.getVersion(),
            })
          : null,
      )
      .catch((error) =>
        log.warn("Browser integration auto-repair:", error.message),
      );
  }
  if (updater)
    setTimeout(
      () =>
        updater
          .check()
          .catch((error) => log.warn("Update check:", error.message)),
      5000,
    );
  if (selfTest) {
    const reportIndex = process.argv.indexOf("--report");
    const report = process.argv[reportIndex + 1];
    try {
      const result = await require("./self-test").runSelfTest({
        services,
        win,
        app,
        binPath,
        userDataPath,
      });
      if (traySelfTest) {
        const delay = (milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds));
        await services.settings.set("closeToTray", true);
        await services.settings.set("clipboardMonitoring", true);
        const closedAt = Date.now();
        win.close();
        const closeDeadline = Date.now() + 5000;
        while (win && Date.now() < closeDeadline) await delay(25);
        if (win) throw new Error("Window did not release to the tray.");
        const closeToTrayMs = Date.now() - closedAt;
        if (!tray || !services.wsServer.status().running || services.closing)
          throw new Error("Tray services did not remain available.");
        // BrowserWindow.close/destroy settles before Chromium's renderer
        // process disappears from OS metrics. Wait for process teardown with
        // a real deadline rather than mistaking a short-lived exit for a leak.
        const rendererDeadline = Date.now() + 8000;
        let released = app.getAppMetrics();
        while (
          released.some((metric) => metric.type === "Tab") &&
          Date.now() < rendererDeadline
        ) {
          await delay(100);
          released = app.getAppMetrics();
        }
        const lingering = released.filter((metric) => metric.type === "Tab");
        if (lingering.length)
          throw new Error(
            "Renderer process remained after tray close: " +
              lingering.map((metric) => metric.pid).join(","),
          );
        const beforeIdle = process.cpuUsage();
        await delay(10000);
        const cpu = process.cpuUsage(beforeIdle);
        const metrics = app.getAppMetrics().map((metric) => ({
          type: metric.type,
          pid: metric.pid,
          workingSetKiB: metric.memory?.workingSetSize ?? null,
          privateKiB: metric.memory?.privateBytes ?? null,
          cpuPercent: metric.cpu?.percentCPUUsage ?? null,
        }));
        const workingSetKiB = metrics.reduce(
          (sum, metric) => sum + (metric.workingSetKiB || 0),
          0,
        );
        const bridge = services.wsServer.status();
        const WebSocket = require("ws");
        const client = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        const receive = (type) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Timed out waiting for ${type}.`)),
              5000,
            );
            const listener = (raw) => {
              const message = JSON.parse(raw.toString());
              if (message.type !== type) return;
              clearTimeout(timer);
              client.off("message", listener);
              resolve(message);
            };
            client.on("message", listener);
          });
        await new Promise((resolve, reject) => {
          client.once("open", resolve);
          client.once("error", reject);
        });
        const authenticated = receive("authenticated");
        client.send(
          JSON.stringify({
            type: "authenticate",
            token: services.identity.nativeToken,
            transport: "native",
          }),
        );
        await authenticated;
        const hello = receive("hello-result");
        client.send(
          JSON.stringify({
            type: "hello",
            browserId: "chromium",
            extensionId: require("./browser-integration/catalog").CHROMIUM_ID,
            version: "tray-self-test",
          }),
        );
        await hello;
        const requestId = `tray-self-test-${Date.now()}`;
        const wakeStarted = Date.now();
        const wake = receive("download-result");
        client.send(
          JSON.stringify({
            type: "download",
            requestId,
            kind: "media",
            url: "https://example.invalid/tray-self-test",
            transferId: requestId,
          }),
        );
        const wakeResult = await wake;
        const wakeDeadline = Date.now() + 10000;
        while (
          (!win || win.isDestroyed() || !win.isVisible()) &&
          Date.now() < wakeDeadline
        )
          await delay(25);
        client.close();
        if (!win || win.isDestroyed() || !win.isVisible())
          throw new Error("Browser request did not restore the app window.");
        if (wakeResult.action !== "analyze")
          throw new Error("Browser bridge did not accept the wake request.");
        await services.ackBrowserRequest(wakeResult.pendingId);
        result.trayLifecycle = {
          passed: true,
          closeToTrayMs,
          browserWakeMs: Date.now() - wakeStarted,
          idleCpuMicrosOver10Seconds: cpu.user + cpu.system,
          idleMetrics: metrics,
          reportedWorkingSetMiB: Math.round((workingSetKiB / 1024) * 100) / 100,
          rendererReleased: true,
          bridgeStayedAvailable: true,
          browserRequestWokeWindow: true,
          gpuUtilization: "Electron does not expose GPU utilization counters",
        };
        result.trayLifecycle.under50MB =
          result.trayLifecycle.reportedWorkingSetMiB <= 50;
      }
      await fs.mkdir(path.dirname(path.resolve(report)), { recursive: true });
      await fs.writeFile(report, JSON.stringify(result, null, 2));
      await services.close();
      shutdownFinished = true;
      app.exit(result.passed ? 0 : 1);
    } catch (error) {
      await fs.writeFile(
        report,
        JSON.stringify({ passed: false, error: error.stack }),
      );
      await services.close();
      shutdownFinished = true;
      app.exit(1);
    }
  }
  log.info("Ready", {
    version: app.getVersion(),
    bridge: services.wsServer.status(),
  });
}
if (
  !setupOnly &&
  !unregisterOnly &&
  !selfTest &&
  !app.requestSingleInstanceLock()
)
  app.quit();
else {
  app.on("second-instance", (_event, commandLine) => {
    if (commandLine.includes("--scheduled-downloads")) services?.manager.pump();
    else showWindow();
  });
  app
    .whenReady()
    .then(async () => {
      const markerPath = desktopExitMarkerPath(app.getPath("userData"));
      const fromBrowser = process.argv.includes("--from-browser");
      if (fromBrowser && isDesktopExitMarked(markerPath)) {
        log.info(
          "Browser launch ignored because GetANNY was explicitly closed.",
        );
        app.exit(0);
        return;
      }
      if (!fromBrowser && !setupOnly && !unregisterOnly && !selfTest)
        clearDesktopExitMarker(markerPath);
      await init();
    })
    .catch(async (error) => {
      log.error(error);
      await recordOperationStage("error", { error: error.message }).catch(
        () => {},
      );
      if (unregisterOnly)
        await fs
          .writeFile(
            path.join(app.getPath("userData"), "browser-uninstall-report.json"),
            JSON.stringify(
              {
                passed: false,
                date: new Date().toISOString(),
                error: error.message,
              },
              null,
              2,
            ),
          )
          .catch(() => {});
      if (!setupOnly && !unregisterOnly && !selfTest)
        dialog.showErrorBox("GetANNY could not start", error.message);
      app.exit(1);
    });
  app.on("before-quit", (event) => {
    exiting = true;
    if (shutdownFinished || !services) return;
    event.preventDefault();
    if (services.closing) return;
    services.closing = true;
    if (!selfTest && !setupOnly && !unregisterOnly)
      markDesktopExited(desktopExitMarkerPath(app.getPath("userData")));
    services
      .close()
      .catch((error) => log.error("Shutdown:", error))
      .finally(() => {
        shutdownFinished = true;
        tray?.destroy();
        app.exit(0);
      });
  });
  app.on("window-all-closed", () => {
    if (shouldKeepBackgroundProcess(hiddenToTray, !!tray)) return;
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!shouldRevealOnActivation(hiddenToTray)) return;
    if (win) showWindow();
    else if (services) createWindow().catch((error) => log.error(error));
  });
}
process.on("uncaughtException", (error) => log.error(error));
process.on("unhandledRejection", (error) => log.error(error));
