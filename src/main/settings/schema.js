const shortcuts = require("../../shared/shortcuts.json");
const path = require("node:path");
const {
  MAX_CONCURRENT_DOWNLOADS,
  MAX_FILE_CONNECTIONS,
} = require("../engine/transfer-integrity");
const THEMES = require("../../shared/themes.json").map((theme) => theme.id);
const { browsers } = require("../browser-integration/catalog");
const LANGUAGES = require("../../shared/languages.json").map(
  (language) => language.code,
);
const BOOLEAN_KEYS = [
  "autoStartDownloads",
  "adaptiveSpeedLimit",
  "resumeOnStartup",
  "scheduleEnabled",
  "scheduleWakeEnabled",
  "organizeByType",
  "notifications",
  "closeToTray",
  "launchAtLogin",
  "startMinimized",
  "compactList",
  "reduceMotion",
  "browserIntegrationEnabled",
  "mediaIntegration",
  "firstRunCompleted",
  "clipboardMonitoring",
  "completionSound",
  "bringToFrontOnCapture",
  "welcomeCompleted",
];
const NUMBER_RULES = {
  maxConcurrentDownloads: [1, MAX_CONCURRENT_DOWNLOADS],
  maxConnectionsPerDownload: [1, MAX_FILE_CONNECTIONS],
  speedLimit: [0, 1024 ** 4],
  activeSpeedLimit: [0, 1024 ** 4],
  idleSpeedLimit: [0, 1024 ** 4],
  idleAfterSeconds: [15, 3600],
  requestTimeoutSeconds: [5, 300],
  retryAttempts: [0, 5],
  retryDelaySeconds: [1, 120],
  completionSoundVolume: [0, 100],
  scheduleStartMinute: [0, 1439],
  scheduleEndMinute: [0, 1439],
};
const BROWSERS = browsers.map(({ id }) => id);
function defaults(downloadPath) {
  return {
    defaultDownloadPath: downloadPath,
    maxConcurrentDownloads: 3,
    maxConnectionsPerDownload: 8,
    speedLimit: 0,
    adaptiveSpeedLimit: false,
    activeSpeedLimit: 1024 * 1024,
    idleSpeedLimit: 0,
    idleAfterSeconds: 120,
    requestTimeoutSeconds: 30,
    retryAttempts: 2,
    retryDelaySeconds: 3,
    autoStartDownloads: true,
    resumeOnStartup: true,
    scheduleEnabled: false,
    scheduleWakeEnabled: false,
    scheduleStartMinute: 0,
    scheduleEndMinute: 360,
    organizeByType: false,
    destinationRules: {},
    notifications: true,
    closeToTray: true,
    launchAtLogin: false,
    startMinimized: false,
    theme: "evergreen",
    language: "en",
    compactList: false,
    interfaceSize: "classic",
    interfaceFont: "inter",
    reduceMotion: false,
    animationMode: "standard",
    browserIntegrationEnabled: true,
    mediaIntegration: true,
    firstRunCompleted: false,
    clipboardMonitoring: false,
    completionSound: true,
    completionSoundVolume: 50,
    preferredBrowser: "chrome",
    bringToFrontOnCapture: true,
    welcomeCompleted: false,
    shortcuts: {},
    // New installations default to no quality cap and any container.
    // Never overwrite an existing saved user preference.
    mediaPreferences: {
      height: 0,
      container: "any",
      audioLanguage: "",
      subtitleLanguage: "",
    },
  };
}
function validateSetting(key, value) {
  if (BOOLEAN_KEYS.includes(key)) {
    if (typeof value !== "boolean")
      throw new Error(`${key} must be on or off.`);
  } else if (NUMBER_RULES[key]) {
    const [min, max] = NUMBER_RULES[key];
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(
        `${key} must be a whole number between ${min} and ${max}.`,
      );
  } else if (key === "defaultDownloadPath") {
    if (
      typeof value !== "string" ||
      !path.isAbsolute(value) ||
      value.includes("\0")
    )
      throw new Error("Select an absolute download folder path.");
  } else if (key === "destinationRules") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length > 8
    )
      throw new Error("Invalid destination rules.");
    for (const [category, folder] of Object.entries(value))
      if (
        ![
          "Video",
          "Audio",
          "Images",
          "Documents",
          "Archives",
          "Applications",
          "Torrents",
          "Other",
        ].includes(category) ||
        typeof folder !== "string" ||
        !path.isAbsolute(folder) ||
        folder.includes("\0")
      )
        throw new Error("Choose an absolute folder for a supported category.");
  } else if (key === "shortcuts") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Choose valid shortcut bindings.");
    for (const [id, binding] of Object.entries(value)) {
      const [scope, action, extra] = id.split(".");
      if (
        extra ||
        !Object.hasOwn(shortcuts, scope) ||
        !Object.hasOwn(shortcuts[scope], action) ||
        typeof binding !== "string" ||
        !/^(?:Mod\+)?(?:Alt\+)?(?:Shift\+)?(?:[a-z0-9,.;/]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Space|Home|End|PageUp|PageDown)$/.test(
          binding,
        ) ||
        (scope === "global" &&
          !binding.startsWith("Mod+") &&
          !/^F(?:[1-9]|1[0-2])$/.test(binding))
      )
        throw new Error(
          "Choose a valid shortcut. Global shortcuts require Ctrl, Command, or a function key.",
        );
    }
    const global = Object.entries(shortcuts.global).map(
      ([action, key]) => value[`global.${action}`] ?? key,
    );
    if (new Set(global).size !== global.length)
      throw new Error("That shortcut is already in use.");
    for (const [scope, actions] of Object.entries(shortcuts)) {
      if (scope === "global") continue;
      const local = Object.entries(actions).map(
        ([action, key]) => value[`${scope}.${action}`] ?? key,
      );
      if (new Set([...global, ...local]).size !== global.length + local.length)
        throw new Error("That shortcut is already in use.");
    }
  } else if (key === "mediaPreferences") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (k) =>
          ![
            "height",
            "container",
            "audioLanguage",
            "subtitleLanguage",
          ].includes(k),
      ) ||
      ![0, 480, 720, 1080, 1440, 2160, 4320].includes(value.height) ||
      !["any", "mp4", "webm"].includes(value.container) ||
      ![value.audioLanguage, value.subtitleLanguage].every(
        (v) =>
          typeof v === "string" && v.length <= 35 && /^[a-zA-Z0-9_-]*$/.test(v),
      )
    )
      throw new Error("Choose valid media preferences.");
  } else if (key === "interfaceFont") {
    if (!["inter", "system", "segoe"].includes(value))
      throw new Error("Choose a supported interface typeface.");
  } else if (key === "interfaceSize") {
    if (
      !["minimal", "dense", "compact", "classic", "comfortable"].includes(value)
    )
      throw new Error("Choose a supported interface size.");
  } else if (key === "theme") {
    if (![...THEMES, "system"].includes(value))
      throw new Error("Choose a supported theme.");
  } else if (key === "language") {
    if (!LANGUAGES.includes(value))
      throw new Error("Choose a supported language.");
  } else if (key === "animationMode") {
    if (!["standard", "expressive", "reduced", "disabled"].includes(value))
      throw new Error("Choose a supported animation mode.");
  } else if (key === "preferredBrowser") {
    if (!BROWSERS.includes(value))
      throw new Error("Choose a supported browser.");
  } else throw new Error(`Unknown preference: ${key}`);
  return value;
}
module.exports = { defaults, validateSetting, BROWSERS };
