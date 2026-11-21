/* GetANNY Browser Assistant enhancements.
   This list is from the browser's downloads API, not GetANNY's desktop DB.
   We never fetch remote thumbnails or expose cookies in filenames or tooltips. */
(() => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const prefs = globalThis.GetANNYDownloadPreferences;
  const byId = (id) => document.getElementById(id);
  const views = ["downloads", "capture", "settings"];

  function openView(name) {
    if (!views.includes(name)) return;
    for (const view of views) {
      const pane = byId("view-" + view);
      const tab = document.querySelector('[data-view="' + view + '"]');
      if (!pane || !tab) continue;
      pane.hidden = view !== name;
      tab.classList.toggle("is-active", view === name);
      tab.setAttribute("aria-selected", String(view === name));
      tab.tabIndex = view === name ? 0 : -1;
    }
    if (name === "downloads") void refreshRecent();
  }

  const types = {
    mp4:["Video","VID"],webm:["Video","VID"],mov:["Video","VID"],mkv:["Video","VID"],
    m4v:["Video","VID"],mp3:["Audio","AUD"],m4a:["Audio","AUD"],wav:["Audio","AUD"],
    flac:["Audio","AUD"],jpg:["Image","IMG"],jpeg:["Image","IMG"],png:["Image","IMG"],
    webp:["Image","IMG"],gif:["Image","IMG"],avif:["Image","IMG"],pdf:["PDF document","PDF"],
    zip:["Archive","ZIP"],rar:["Archive","ZIP"],"7z":["Archive","ZIP"],tar:["Archive","ZIP"],
    exe:["Application","APP"],msi:["Application","APP"],docx:["Document","DOC"],
    txt:["Document","DOC"],md:["Document","DOC"]
  };
  function classify(name) {
    const ext = name.split(".").pop().toLowerCase();
    return types[ext] || ["File","FILE"];
  }
  function size(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "Size unknown";
    if (bytes < 1024) return String(bytes) + " B";
    const i = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024,i)).toFixed(i <= 1 ? 0 : 1) +
      " " + ["B","KB","MB","GB","TB"][i];
  }
  function host(url) {
    try { return new URL(url).hostname; } catch { return "Unknown website"; }
  }
  function fileName(item) {
    const path = typeof item.filename === "string" ? item.filename : "";
    const name = path.split(/[\\/]/).pop().trim();
    if (name) return name.slice(0,180);
    try {
      return decodeURIComponent(new URL(item.finalUrl || item.url).pathname.split("/").pop() || "")
        .slice(0,180) || "Unnamed download";
    } catch { return "Unnamed download"; }
  }
  function render(item) {
    const name = fileName(item);
    const kind = classify(name);
    const state = item.state === "complete" ? "Completed" :
      item.state === "interrupted" ? "Interrupted" : "In progress";
    const bytes = Number(item.totalBytes) >= 0 ? Number(item.totalBytes) : Number(item.bytesReceived);
    const origin = host(item.finalUrl || item.url);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "download-row";
    row.setAttribute("aria-label", [name,kind[0],size(bytes),state,origin].join(", "));
    row.title = name + "\n" + kind[0] + " · " + size(bytes) + " · " + state +
      "\nSource: " + origin + "\nClick to show in browser downloads";
    const icon = document.createElement("span");
    icon.className = "download-icon"; icon.textContent = kind[1];
    const info = document.createElement("span"); info.className = "download-content";
    const title = document.createElement("span"); title.className = "download-name"; title.textContent = name;
    const meta = document.createElement("span"); meta.className = "download-meta";
    meta.textContent = kind[0] + " · " + size(bytes) + " · " + state;
    const hover = document.createElement("span"); hover.className = "download-hover";
    const date = item.startTime ? new Date(item.startTime).toLocaleDateString() : "Date unknown";
    hover.textContent = "Source: " + origin + " · " + date;
    info.append(title,meta,hover);
    const chevron = document.createElement("span");
    chevron.className = "download-chevron"; chevron.setAttribute("aria-hidden","true");
    chevron.textContent = "›";
    row.append(icon,info,chevron);
    row.addEventListener("click", () => {
      try {
        if (api.downloads?.show)
          void Promise.resolve(api.downloads.show(item.id)).catch(() => {});
        else if (api.tabs?.create)
          void Promise.resolve(api.tabs.create({url:"chrome://downloads/"})).catch(() => {});
      } catch { /* Browser downloads may no longer contain the file. */ }
    });
    return row;
  }
  async function refreshRecent() {
    const list = byId("recent-downloads");
    if (!list) return;
    if (!api.downloads?.search) { list.textContent = "Browser download history is unavailable."; return; }
    try {
      const items = await api.downloads.search({limit:18,orderBy:["-startTime"]});
      const fragment = document.createDocumentFragment();
      for (const item of items) fragment.append(render(item));
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No recent browser downloads. Open the desktop app for your GetANNY transfers.";
        fragment.append(empty);
      }
      list.replaceChildren(fragment);
    } catch {
      list.textContent = "Could not read recent browser downloads.";
    }
  }
  async function initialize() {
    for (const tab of document.querySelectorAll("[data-view]")) {
      tab.addEventListener("click", () => openView(tab.dataset.view));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = views.indexOf(tab.dataset.view);
        const next = (index + (event.key === "ArrowRight" ? 1 : 2)) % views.length;
        openView(views[next]);
        document.querySelector('[data-view="' + views[next] + '"]').focus();
      });
    }
    byId("refresh-recent")?.addEventListener("click", refreshRecent);
    openView("downloads");
    const master = byId("extension-enabled");
    const automatic = byId("automatic-capture");
    const cookie = byId("include-site-cookies");
    const saved = await api.storage.local.get([prefs.enabledKey]);
    master.checked = saved[prefs.enabledKey] !== false;
    const applyEnabled = (enabled) => {
      document.body.classList.toggle("extension-off", !enabled);
      for (const id of ["automatic-capture","keep-site","include-site-cookies","hide-overlay",
                        "send","tab","url","kind","download-social"]) {
        const node = byId(id);
        if (node) node.disabled = !enabled;
      }
      if (enabled) {
        void api.storage.local.get([prefs.automaticKey]).then((savedAutomatic) => {
          automatic.checked = savedAutomatic[prefs.automaticKey] !== false;
        }).catch(() => {});
      }
    };
    applyEnabled(master.checked);
    master.addEventListener("change", async () => {
      const enabled = master.checked;
      master.disabled = true;
      try {
        await api.storage.local.set({[prefs.enabledKey]:enabled});
        applyEnabled(enabled);
      } catch (error) {
        master.checked = !enabled;
        applyEnabled(master.checked);
        byId("message").textContent = "Could not change extension state: " + error.message;
      } finally { master.disabled = false; }
    });
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[prefs.enabledKey]) return;
      master.checked = changes[prefs.enabledKey].newValue !== false;
      applyEnabled(master.checked);
    });
    if (cookie) cookie.title = "Matching download-site cookies only, enabled by default; never exported to the popup";
  }
  void initialize().catch((error) => {
    const note = byId("message");
    if (note) note.textContent = "Controls unavailable: " + error.message;
  });
  api.downloads?.onCreated?.addListener?.(() => void refreshRecent());
  api.downloads?.onChanged?.addListener?.(() => void refreshRecent());
})();
