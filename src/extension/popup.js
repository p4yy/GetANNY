const api = globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);
const status = $("status"),
  message = $("message");
function feedback(text, error = false) {
  message.textContent = text;
  message.className = error ? "error" : "";
}
function applyTheme(theme) {
  if (!theme || typeof theme !== "object" || !theme.colors) return;
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.colors))
    if (/^--[a-z0-9-]+$/.test(token) && typeof value === "string")
      root.style.setProperty(token, value);
  root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
  root.dataset.theme = theme.id || "nord";
}
api.runtime.onMessage.addListener((incoming) => {
  if (incoming?.type === "theme") applyTheme(incoming.theme);
});
async function send(payload) {
  const response = await api.runtime.sendMessage(payload);
  if (response?.success === false) throw new Error(response.error);
  return response;
}
async function refresh() {
  try {
    const response = await send({ type: "status" });
    status.className = `connection ${response.connected ? "online" : "offline"}`;
    status.textContent = response.connected
      ? `Connected · ${response.transport === "native" ? "Native bootstrap" : "Secure local bridge"}`
      : response.error || "Waiting for desktop handshake…";
  } catch (error) {
    status.textContent = error.message;
    status.className = "connection offline";
  }
}
async function submit(url, kind) {
  $("send").disabled = true;
  feedback("Waiting for desktop acknowledgement…");
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const privateSession = tab?.incognito === true;
    const includeSiteCookies =
      $("include-site-cookies").checked && kind === "file" && !privateSession;
    let headers;
    if (includeSiteCookies) {
      const target = new URL(url);
      if (!/^https?:$/.test(target.protocol))
        throw new Error("Cookies are only available for HTTP or HTTPS links.");
      const cookies = await api.cookies.getAll({ url: target.href });
      if (cookies.length)
        headers = {
          Cookie: cookies
            .map(({ name, value }) => `${name}=${value}`)
            .join("; "),
        };
    }
    const response = await send({
      type: "download",
      url,
      kind,
      headers,
      includeSiteCookies,
      privateSession,
    });
    feedback(
      response.action === "queued"
        ? "Download queued in GetANNY."
        : response.action === "analyze"
          ? "Media page opened in GetANNY. Choose a format there."
          : "Sent for review in GetANNY. Confirm the destination there.",
    );
  } catch (error) {
    feedback(error.message, true);
  } finally {
    $("send").disabled = false;
    refresh();
  }
}
$("download-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submit($("url").value.trim(), $("kind").value);
});
$("tab").onclick = async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (/^https?:\/\//.test(tab?.url || "")) {
    let url = tab.url;
    if (globalThis.GetANNYSocialLinks.socialSite(url) === "tiktok") {
      const canonical = globalThis.GetANNYSocialLinks.postLink(url, url);
      const current = canonical ? { url: canonical } : await api.tabs
        .sendMessage(tab.id, { type: "getanny:active-post" }, { frameId: 0 })
        .catch(() => null);
      if (!current?.url) {
        feedback("TikTok feed is not an individual video. Open the post or copy its video link.", true);
        return;
      }
      url = current.url;
    }
    $("url").value = url;
    $("kind").value = "media";
  } else feedback("This browser page cannot be downloaded.", true);
};
$("reconnect").onclick = async () => {
  status.textContent = "Reconnecting…";
  try {
    await send({ type: "reconnect" });
  } catch (error) {
    feedback(error.message, true);
  }
  refresh();
};
$("pair").onclick = async () => {
  $("pair").disabled = true;
  try {
    await send({
      type: "configure",
      browserId: $("browser").value,
      pairingKey: $("pairing").value,
    });
    feedback("Desktop handshake verified.");
  } catch (error) {
    feedback(error.message, true);
  } finally {
    $("pair").disabled = false;
    refresh();
  }
};
(async () => {
  try {
    applyTheme(await send({ type: "theme" }));
  } catch {
    /* the popup still works without a synced palette */
  }
  const saved = await api.storage.local.get([
    "browserId",
    "pairingKey",
    "includeSiteCookies",
  ]);
  $("browser").value =
    saved.browserId || globalThis.GETANNY_BROWSER || "chrome";
  $("pairing").value = saved.pairingKey || "";
  // Default to enabled so cloud/private downloads work without a surprise
  // failure. An explicit opt-out (false) is preserved across popup sessions.
  $("include-site-cookies").checked = saved.includeSiteCookies !== false;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const overlayKey = globalThis.GetANNYOverlayPreferences.siteKey(tab?.url);
  if (overlayKey) {
    const storage = api.storage.sync || api.storage.local;
    const input = $("hide-overlay");
    input.checked = Boolean(
      (await storage.get(overlayKey))[overlayKey]?.hidden,
    );
    $("overlay-settings").hidden = false;
    input.addEventListener("change", async () => {
      try {
        const existing = (await storage.get(overlayKey))[overlayKey] || {};
        await storage.set({
          [overlayKey]: { ...existing, hidden: input.checked },
        });
      } catch (error) {
        input.checked = !input.checked;
        feedback(error.message, true);
      }
    });
  }
  if (tab?.id != null && !tab.incognito) {
    const posts = await api.tabs
      .sendMessage(tab.id, { type: "social-links" }, { frameId: 0 })
      .catch(() => null);
    const button = $("download-social");
    if (posts?.links?.length) {
      button.hidden = false;
      button.textContent =
        "Download all media posts (" + posts.links.length + ")";
      button.onclick = async () => {
        button.disabled = true;
        feedback("Sending posts to the GetANNY queue…");
        try {
          const latest = await api.tabs.sendMessage(
            tab.id,
            { type: "social-links" },
            { frameId: 0 },
          );
          const result = await send({
            type: "social-batch",
            tabId: tab.id,
            urls: latest.links,
          });
          feedback(
            result.accepted +
              " posts sent to GetANNY. Check the desktop queue for results.",
          );
        } catch (error) {
          feedback(error.message, true);
        } finally {
          button.disabled = false;
        }
      };
    }
  }
  const response = await send({ type: "detected", tabId: tab?.id });
  const items = (response?.items || []).filter((item) =>
    globalThis.GetANNYSocialLinks.socialSite(item.url) !== "tiktok" ||
    Boolean(globalThis.GetANNYSocialLinks.postLink(item.url, item.url)),
  );
  $("detected-section").hidden = !items.length;
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "detected-item";
    let name;
    try {
      name =
        decodeURIComponent(new URL(item.url).pathname.split("/").pop()) ||
        item.title;
    } catch {
      name = item.title;
    }
    button.textContent = `${item.kind === "media" ? "Analyze" : "Download"} · ${name || item.mimeType || "Media"}`;
    button.title = item.url;
    button.onclick = () => submit(item.url, item.kind);
    $("detected").appendChild(button);
  }
})().catch((error) => feedback(error.message, true));
$("include-site-cookies").addEventListener("change", () => {
  api.storage.local
    .set({ includeSiteCookies: $("include-site-cookies").checked })
    .catch(() => {});
});
refresh();
setInterval(refresh, 2000);
