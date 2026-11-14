/* Shared extension implementation. Browser-specific config is generated at packaging. */
if (typeof importScripts === "function")
  importScripts(
    "config.js",
    "download-interceptor.js",
    "stream-detection.js",
    "social-links.js",
    "site-downloads.js",
  );
const api = globalThis.browser || globalThis.chrome;
const action = api.action || api.browserAction;
const packagedConfig = globalThis.GETANNY_CONFIG || {};
const pending = new Map();
const detected = new Map();
const MAX_DETECTIONS = 200;
const capturedPlayback = new Map();
const captureChecks = new Map();
// Passive observation only: never initiate a video transfer, wake the desktop
// or send browser cookies from this path.
function forwardPlayback({ url, pageUrl, mimeType, title }) {
  if (!state.connected || !url?.startsWith("https://") ||
      !pageUrl || !["video/mp4", "video/webm", "video/quicktime"].includes(
        String(mimeType || "").split(";")[0].toLowerCase())) return;
  const key = pageUrl + "|" + url;
  const last = capturedPlayback.get(key) || 0;
  if (Date.now() - last < 15000) return;
  capturedPlayback.set(key, Date.now());
  while (capturedPlayback.size > 80)
    capturedPlayback.delete(capturedPlayback.keys().next().value);
  try {
    sendRaw({ type: "media-detected", url, pageUrl, mimeType, title });
  } catch { /* A disconnected browser still uses ordinary analysis. */ }
}
async function captureVideoResponse(details, mimeType) {
  if (!state.connected || details.tabId < 0) return;
  // Deduplicate BEFORE asynchronous tab messaging: media players often make
  // repeated range requests and should never flood the browser worker.
  const key = details.tabId + "|" + details.url;
  if ((captureChecks.get(key) || 0) > Date.now() - 30000) return;
  captureChecks.set(key, Date.now());
  while (captureChecks.size > 100) captureChecks.delete(captureChecks.keys().next().value);
  try {
    const tab = await api.tabs.get(details.tabId);
    if (!tab || tab.incognito ||
        globalThis.GetANNYSocialLinks.socialSite(tab.url) !== "tiktok") return;
    const reported = await api.tabs.sendMessage(details.tabId,
      { type: "getanny:active-post" }).catch(() => null);
    const post = globalThis.GetANNYSocialLinks.postLink(
      reported?.url || tab.url, tab.url);
    if (!post) return;
    forwardPlayback({
      url: details.url, pageUrl: post, mimeType,
      title: String(tab.title || "TikTok video").slice(0, 160),
    });
  } catch { /* Tabs may navigate while the response arrives. */ }
}
const { addDetection, classifyMediaResponse } =
  globalThis.GetANNYStreamDetection;
let nativePort,
  socket,
  connecting,
  connectResolve,
  connectReject,
  connectTimeout,
  heartbeat,
  activeTransport,
  attempt;
let reconnectTimer;
let reconnectAttempts = 0;
let directUpgradeTimer;
let directUpgradeAttempts = 0;
let directUpgradeRounds = 0;
let connectionGeneration = 0;
let state = { connected: false, transport: null, error: null };
let currentTheme = null;
let browserId =
  packagedConfig.browserId || globalThis.GETANNY_BROWSER || "chrome";
let pairingKey = "";
let interceptor;
const validUrl = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const validPairingKey = (value) => /^[a-f0-9]{64}$/i.test(value || "");
const hasHeader = (headers, name) =>
  Object.keys(headers || {}).some((key) => key.toLowerCase() === name);
async function withSiteCookies(url, headers = {}) {
  if (hasHeader(headers, "cookie") || !api.cookies?.getAll) return headers;
  try {
    const saved = await api.storage.local.get(["includeSiteCookies"]);
    // Site cookies are required for cloud/private files by default. The popup
    // and interceptor pass an explicit false when the user opts out.
    if (saved.includeSiteCookies === false) return headers;
    const cookies = await api.cookies.getAll({ url });
    if (!cookies.length) return headers;
    return {
      ...headers,
      Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    };
  } catch {
    // Private windows, restricted stores and missing permission fall back to
    // the browser copy instead of failing the handoff.
    return headers;
  }
}
const requestId = () => crypto.randomUUID();
function update(next) {
  state = { ...state, ...next };
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(30000, 1500 * 2 ** Math.min(reconnectAttempts, 4));
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((error) => update({ error: error.message }));
  }, delay);
}
function rejectPending(error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    const failure = new Error(
      error?.message || error || "Desktop connection lost.",
    );
    failure.ambiguous = true;
    entry.reject(failure);
  }
  pending.clear();
}
function stopHeartbeat() {
  clearInterval(heartbeat);
  heartbeat = null;
}
function closeSocket() {
  if (!socket) return;
  const current = socket;
  socket = null;
  current.onopen = null;
  current.onmessage = null;
  current.onerror = null;
  current.onclose = null;
  try {
    current.close();
  } catch {
    /* already closed */
  }
}
function closeNative() {
  if (!nativePort) return;
  const current = nativePort;
  nativePort = null;
  try {
    current.disconnect();
  } catch {
    /* already disconnected */
  }
}
function sendRaw(message) {
  if (activeTransport === "native" && nativePort)
    nativePort.postMessage(message);
  else if (
    activeTransport === "websocket" &&
    socket?.readyState === WebSocket.OPEN
  )
    socket.send(JSON.stringify(message));
  else throw new Error("GetANNY is not connected.");
}
function hello() {
  sendRaw({
    type: "hello",
    requestId: requestId(),
    browserId,
    extensionId: api.runtime.id,
    version: api.runtime.getManifest().version,
    protocol: 2,
  });
}
function applyTheme(theme) {
  if (!theme || typeof theme !== "object" || !theme.colors) return;
  currentTheme = theme;
  Promise.resolve(api.storage.local.set({ getannyTheme: theme })).catch(
    () => {},
  );
  interceptor?.theme?.(theme);
}
function scheduleNativeUpgrade() {
  // One bounded attempt per saved identity. If direct dialing fails, retain
  // the working native session rather than falling into an upgrade loop.
  if (directUpgradeRounds >= 1) return;
  if (directUpgradeTimer || activeTransport !== "native" ||
      !state.connected || !validPairingKey(pairingKey)) return;
  directUpgradeTimer = setTimeout(() => {
    directUpgradeTimer = null;
    if (activeTransport !== "native" || !state.connected ||
        !validPairingKey(pairingKey)) return;
    // Never cut over while a download request or native takeover is owned by
    // the browser. Finish the work on its original transport first.
    if (pending.size > 0 || (interceptor?.entries?.size || 0) > 0) {
      if (++directUpgradeAttempts <= 20) scheduleNativeUpgrade();
      return;
    }
    directUpgradeAttempts = 0;
    directUpgradeRounds++;
    resetConnection("Switching from native bootstrap to authenticated direct connection.");
    connect().catch((error) => update({ error: error.message }));
  }, 350);
}
function connectionReady(message) {
  clearTimeout(connectTimeout);
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
  if (validPairingKey(message.pairingToken)) {
    if (message.pairingToken !== pairingKey) directUpgradeRounds = 0;
    // A successful browser-brokered native handshake can securely bootstrap
    // the direct credential. All later reconnects bypass registry discovery.
    pairingKey = message.pairingToken;
    const provisionedKey = pairingKey;
    api.storage.local
      .set({
        pairingKey,
        browserId,
        pairingOverride: false,
        provisionedProtocol: 2,
      })
      .then(() => {
        // A working native handshake is a trusted *bootstrap*, not the final
        // direct channel. Upgrade only after the credential is durably saved.
        if (activeTransport === "native" &&
            state.connected && pairingKey === provisionedKey)
          scheduleNativeUpgrade();
      })
      .catch(() => {
        // Native transport remains usable if the private browser store rejects
        // persistence. Do not disconnect a working session in that case.
      });
  }
  update({ connected: true, transport: message.transport, error: null });
  if (message.theme) applyTheme(message.theme);
  connectResolve?.(state);
  connecting = null;
  connectResolve = null;
  connectReject = null;
  attempt = null;
  stopHeartbeat();
  heartbeat = setInterval(() => {
    try {
      sendRaw({ type: "ping", requestId: requestId() });
      interceptor?.reconnect().catch(() => {});
    } catch {
      connectionLost("Desktop connection lost.");
    }
  }, 25000);
  interceptor?.reconnect().catch((error) => update({ error: error.message }));
}
function deliver(message) {
  if (message.type === "theme") {
    applyTheme(message.theme);
    return;
  }
  if (message.type === "browser-download-command") {
    interceptor
      ?.command(message)
      .then((result) =>
        sendRaw({
          type: "browser-download-result",
          requestId: message.requestId,
          transferId: message.transferId,
          ...result,
        }),
      )
      .catch((error) =>
        sendRaw({
          type: "browser-download-result",
          requestId: message.requestId,
          transferId: message.transferId,
          success: false,
          error: error.message,
        }),
      );
    return;
  }
  if (message.type === "hello-result" && message.success) {
    connectionReady(message);
  } else if (message.type === "transport-error") {
    // The native launcher stays alive while it starts/reconnects the desktop.
    // Keep the attempt open rather than tearing down the only cold-start path.
    update({
      connected: false,
      error: message.error || "Desktop bridge unavailable.",
    });
    if (!connecting) connectionLost(state.error);
    return;
  } else if (message.type === "authentication-error") {
    transportFailed(
      activeTransport,
      message.error || "Desktop authentication failed.",
      connectionGeneration,
    );
    return;
  } else if (
    message.type === "error" &&
    connecting &&
    !pending.has(message.requestId)
  ) {
    transportFailed(
      activeTransport,
      message.error || "Desktop handshake failed.",
      connectionGeneration,
    );
    return;
  }
  const entry = pending.get(message.requestId);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(message.requestId);
    if (message.success) entry.resolve(message);
    else {
      const failure = new Error(
        message.error || "GetANNY rejected the request.",
      );
      failure.definitive = true;
      entry.reject(failure);
    }
  }
}
function connectionLost(error) {
  clearTimeout(directUpgradeTimer);
  directUpgradeTimer = null;
  stopHeartbeat();
  activeTransport = null;
  closeSocket();
  closeNative();
  update({ connected: false, transport: null, error: error?.message || error });
  rejectPending(error);
  interceptor?.disconnected().catch(() => {});
  scheduleReconnect();
}
function failAttempt(error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  clearTimeout(connectTimeout);
  update({ connected: false, transport: null, error: failure.message });
  const reject = connectReject;
  connecting = null;
  connectResolve = null;
  connectReject = null;
  attempt = null;
  activeTransport = null;
  reject?.(failure);
  scheduleReconnect();
}
function resetConnection(reason = "Connection restarted.") {
  connectionGeneration++;
  clearTimeout(directUpgradeTimer);
  directUpgradeTimer = null;
  clearTimeout(connectTimeout);
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  stopHeartbeat();
  closeSocket();
  closeNative();
  const reject = connectReject;
  connecting = null;
  connectResolve = null;
  connectReject = null;
  attempt = null;
  activeTransport = null;
  update({ connected: false, transport: null });
  reject?.(new Error(reason));
}
function transportFailed(kind, error, generation) {
  if (generation !== connectionGeneration) return;
  if (state.connected) {
    if (kind === "websocket") closeSocket();
    else if (kind === "native") closeNative();
    activeTransport = null;
    connectionLost(error);
    return;
  }
  if (!connecting || !attempt) return;
  update({ error: error?.message || error });
  if (kind === "websocket") closeSocket();
  if (kind === "native") closeNative();
  if (!attempt.triedNative) {
    startNative(generation);
    return;
  }
  if (pairingKey && !attempt.triedWebSocket) {
    startWebSocket(generation);
    return;
  }
  failAttempt(error || "GetANNY desktop bridge is unavailable.");
}
function startWebSocket(generation) {
  if (!pairingKey || generation !== connectionGeneration) {
    transportFailed(
      "websocket",
      "No direct bridge credential is available.",
      generation,
    );
    return;
  }
  attempt.triedWebSocket = true;
  closeNative();
  closeSocket();
  activeTransport = "websocket";
  const port = Number(packagedConfig.port) || 29615;
  const current = new WebSocket(`ws://127.0.0.1:${port}`);
  socket = current;
  let socketError =
    "Could not reach GetANNY. Start the desktop app and try again.";
  current.onopen = () => {
    if (generation !== connectionGeneration || socket !== current) return;
    current.send(
      JSON.stringify({
        type: "authenticate",
        token: pairingKey,
        transport: "websocket",
        protocol: 2,
      }),
    );
  };
  current.onmessage = (event) => {
    if (generation !== connectionGeneration || socket !== current) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === "authenticated") hello();
      else deliver(message);
    } catch {
      transportFailed("websocket", "Invalid desktop response.", generation);
    }
  };
  current.onerror = () => {
    socketError =
      "Could not reach GetANNY directly. Trying the browser native bootstrap…";
  };
  current.onclose = () => {
    if (socket === current) socket = null;
    transportFailed("websocket", socketError, generation);
  };
}
function startNative(generation) {
  if (generation !== connectionGeneration) return;
  attempt.triedNative = true;
  closeSocket();
  closeNative();
  activeTransport = "native";
  try {
    const port = api.runtime.connectNative("com.getanny.native");
    nativePort = port;
    port.onMessage.addListener((message) => {
      if (generation === connectionGeneration && nativePort === port)
        deliver(message);
    });
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      const error =
        api.runtime.lastError?.message || "Native host disconnected.";
      nativePort = null;
      transportFailed("native", error, generation);
    });
    hello();
  } catch (error) {
    nativePort = null;
    transportFailed("native", error, generation);
  }
}
async function connect() {
  if (state.connected) return state;
  if (connecting) return connecting;
  const saved = await api.storage.local.get([
    "browserId",
    "pairingKey",
    "pairingOverride",
  ]);
  browserId =
    packagedConfig.browserId ||
    saved.browserId ||
    globalThis.GETANNY_BROWSER ||
    "chrome";
  pairingKey =
    saved.pairingOverride === true && validPairingKey(saved.pairingKey)
      ? saved.pairingKey
      : validPairingKey(packagedConfig.pairingToken)
        ? packagedConfig.pairingToken
        : validPairingKey(saved.pairingKey)
          ? saved.pairingKey
          : "";
  if (connecting) return connecting;
  const generation = ++connectionGeneration;
  attempt = { generation, triedWebSocket: false, triedNative: false };
  connecting = new Promise((resolve, reject) => {
    connectResolve = resolve;
    connectReject = reject;
  });
  const result = connecting;
  connectTimeout = setTimeout(() => {
    if (generation !== connectionGeneration) return;
    closeSocket();
    closeNative();
    failAttempt(
      "No authenticated handshake from GetANNY. Start the app, refresh this browser's prepared package, or use its recovery key.",
    );
  }, 20000);
  // Provisioned/saved credentials make the registry-free path primary. Native
  // messaging remains a cold-start and migration bootstrap only.
  if (pairingKey) startWebSocket(generation);
  else startNative(generation);
  return result;
}
async function request(message) {
  let outgoing =
    message.type === "download"
      ? {
          ...message,
          headers: {
            "User-Agent": globalThis.navigator.userAgent,
            ...(message.headers || {}),
          },
        }
      : message;
  if (
    message.type === "download" &&
    message.kind !== "media" &&
    !message.privateSession &&
    message.includeSiteCookies !== false
  ) {
    outgoing = {
      ...message,
      headers: await withSiteCookies(message.url, outgoing.headers),
    };
  }
  const { includeSiteCookies, ...payload } = outgoing;
  await connect();
  return new Promise((resolve, reject) => {
    const id = requestId();
    const timer = setTimeout(() => {
      pending.delete(id);
      const failure = new Error(
        "GetANNY did not acknowledge the request. Check the desktop application.",
      );
      failure.ambiguous = true;
      reject(failure);
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    try {
      sendRaw({ ...payload, requestId: id });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}
function remember(tabId, media) {
  if (tabId < 0 || !validUrl(media.url)) return;
  const list = detected.get(tabId) || [];
  const next = addDetection(
    list,
    {
      url: media.url,
      title: String(media.title || "").slice(0, 160),
      kind: media.kind === "media" ? "media" : "file",
      mimeType: media.mimeType || "",
      frameId: media.frameId,
      stream: media.stream,
    },
    MAX_DETECTIONS,
  );
  if (next === list) return;
  detected.set(tabId, next);
  action
    ?.setBadgeText({
      tabId,
      text: next.length > 99 ? "99+" : String(next.length),
    })
    .catch?.(() => {});
}
api.runtime.onMessage.addListener((message, sender, respond) => {
  const ui = sender.url?.startsWith(api.runtime.getURL(""));
  (async () => {
    if (message.type === "status") {
      if (!state.connected && !connecting)
        connect().catch((error) => update({ error: error.message }));
      return { ...state, browserId, protocol: 2 };
    }
    if (message.type === "reconnect" && ui) {
      resetConnection("Manual reconnect requested.");
      return connect();
    }
    if (message.type === "configure" && ui) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (
        ![
          "helium",
          "comet",
          "chrome",
          "chromium",
          "brave",
          "firefox",
          "vivaldi",
          "opera",
          "edge",
        ].includes(message.browserId)
      )
        throw new Error("Choose a supported browser.");
      if (message.pairingKey && !/^[a-f0-9]{64}$/i.test(message.pairingKey))
        throw new Error("Copy the complete pairing key from GetANNY.");
      await api.storage.local.set({
        browserId: message.browserId,
        pairingKey: message.pairingKey.trim(),
        pairingOverride: Boolean(message.pairingKey.trim()),
      });
      resetConnection("Connection settings changed.");
      return connect();
    }
    if (message.type === "overlay-site")
      return {
        site: validUrl(sender.tab?.url) ? new URL(sender.tab.url).origin : null,
      };
    if (message.type === "getanny:playback-captured") {
      const tabUrl = sender.tab?.url;
      if (!sender.tab || sender.tab.incognito ||
          globalThis.GetANNYSocialLinks.socialSite(tabUrl) !== "tiktok")
        return { success: false };
      const post = globalThis.GetANNYSocialLinks.postLink(
        message.postUrl, tabUrl);
      if (post) forwardPlayback({
        url: message.streamUrl, pageUrl: post,
        mimeType: message.mimeType || "video/mp4",
        title: message.title,
      });
      return { success: true };
    }
    if (message.type === "media-detected") {
      remember(sender.tab?.id ?? -1, {
        ...message.media,
        frameId: sender.frameId,
      });
      return { success: true };
    }
    if (message.type === "browser-payload" && !ui) {
      if (
        !sender.tab ||
        sender.tab.incognito ||
        !globalThis.GetANNYSiteDownloads.providerFor(sender.url)
      )
        throw new Error("This page cannot send a browser file to GetANNY.");
      return request({ ...message, page: sender.url });
    }
    if (message.type === "social-batch" && ui) {
      const tab = await api.tabs.get(message.tabId);
      if (!tab?.url || tab.incognito)
        throw new Error("Open a supported social page first.");
      return request({
        type: "social-batch",
        page: tab.url,
        urls: message.urls,
      });
    }
    if (message.type === "detected" && ui) {
      const tabId = message.tabId;
      if (!Number.isInteger(tabId) || tabId < 0) return { items: [] };
      if (!(detected.get(tabId) || []).length) {
        try {
          // A page scan recovers reports lost during an early Firefox or
          // Chromium tab update; restricted pages still use the ordinary cache.
          const fresh = await api.tabs.sendMessage(tabId, {
            type: "getanny:scan-media",
          });
          if (Array.isArray(fresh?.items))
            for (const item of fresh.items.slice(0, MAX_DETECTIONS))
              remember(tabId, item);
        } catch {
          // No content script on restricted or closed tabs.
        }
      }
      return {
        items: (detected.get(tabId) || []).map(
          ({ recentFragments, ...item }) => item,
        ),
      };
    }
    if (message.type === "theme") {
      if (currentTheme) return currentTheme;
      const saved = await api.storage.local.get(["getannyTheme"]);
      return saved.getannyTheme || null;
    }
    if (message.type === "download") {
      if (!validUrl(message.url))
        throw new Error(
          "Only HTTP and HTTPS downloads are supported. Blob URLs must be analyzed using the original media page.",
        );
      return request({
        type: "download",
        url: message.url,
        kind: message.kind === "media" ? "media" : "file",
        filename: message.filename,
        page: validUrl(sender.tab?.url) && !sender.tab?.incognito ? sender.tab.url : undefined,
        headers: {
          "User-Agent": globalThis.navigator.userAgent,
          ...(validUrl(sender.tab?.url) ? { Referer: sender.tab.url } : {}),
          ...(message.headers || {}),
        },
        includeSiteCookies: message.includeSiteCookies,
        privateSession:
          sender.tab?.incognito === true ||
          (ui && message.privateSession === true),
      });
    }
    throw new Error("Unsupported extension action.");
  })().then(respond, (error) =>
    respond({ success: false, error: error.message }),
  );
  return true;
});
api.tabs.onRemoved.addListener((tabId) => detected.delete(tabId));
api.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.status === "loading") {
    detected.delete(tabId);
    action?.setBadgeText({ tabId, text: "" }).catch?.(() => {});
  }
});
api.webRequest?.onHeadersReceived.addListener(
  (details) => {
    const type =
      details.responseHeaders?.find(
        (header) => header.name.toLowerCase() === "content-type",
      )?.value || "";
    const disposition = details.responseHeaders?.find(
      (header) => header.name.toLowerCase() === "content-disposition",
    )?.value;
    const output = globalThis.GetANNYSiteDownloads.classifyOutput(
      details.documentUrl || details.initiator || details.originUrl,
      details.url,
      type,
      disposition,
    );
    const media = output || classifyMediaResponse(details.url, type);
    if (state.connected &&
        ["video/mp4", "video/webm", "video/quicktime"].includes(
          String(type).split(";")[0].trim().toLowerCase()) &&
        details.url.startsWith("https://"))
      void captureVideoResponse(details, type);
    if (media)
      remember(details.tabId, {
        ...media,
        url: details.url,
        frameId: details.frameId,
        mimeType: type,
        title:
          output?.title ||
          (media.stream === "hls" ? "HLS playlist" : "Detected media stream"),
      });
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"],
);
api.runtime.onInstalled.addListener(() => {
  Promise.resolve(api.contextMenus.removeAll()).then(() => {
    api.contextMenus.create({
      id: "getanny-link",
      title: "Download with GetANNY",
      contexts: ["link", "video", "audio"],
    });
    api.contextMenus.create({
      id: "getanny-page",
      title: "Analyze media in GetANNY",
      contexts: ["page"],
    });
  });
});
api.contextMenus.onClicked.addListener((info, tab) => {
  const media = info.menuItemId === "getanny-page";
  const url = media ? tab.url : info.linkUrl || info.srcUrl;
  if (validUrl(url))
    request({
      type: "download",
      url,
      kind: media ? "media" : "file",
      page: validUrl(info.pageUrl || tab?.url) && !tab?.incognito
        ? info.pageUrl || tab.url : undefined,
      privateSession: tab?.incognito === true,
      headers: {
        "User-Agent": globalThis.navigator.userAgent,
        ...(validUrl(info.pageUrl || tab?.url)
          ? { Referer: info.pageUrl || tab.url }
          : {}),
      },
    }).catch((error) => update({ error: error.message }));
});
interceptor = new globalThis.GetANNYDownloadInterceptor({
  api,
  request,
  onError: (error) => update({ error: error.message }),
});
interceptor.start();
connect().catch((error) => update({ error: error.message }));
