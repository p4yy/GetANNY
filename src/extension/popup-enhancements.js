/* GetANNY Browser Assistant: local download history and controls. */
(() => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const prefs = globalThis.GetANNYDownloadPreferences;
  const recent = globalThis.GetANNYRecentDownloads;
  const byId = (id) => document.getElementById(id);
  const views = ["downloads", "capture", "settings"];
  let recentItems = [];
  let refreshing = false;
  let refreshQueued = false;

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
    mp4:["Video","VID"],webm:["Video","VID"],mov:["Video","VID"],mkv:["Video","VID"],m4v:["Video","VID"],
    mp3:["Audio","AUD"],m4a:["Audio","AUD"],wav:["Audio","AUD"],flac:["Audio","AUD"],ogg:["Audio","AUD"],
    jpg:["Image","IMG"],jpeg:["Image","IMG"],png:["Image","IMG"],webp:["Image","IMG"],gif:["Image","IMG"],avif:["Image","IMG"],
    pdf:["PDF document","PDF"],zip:["Archive","ZIP"],rar:["Archive","ZIP"],"7z":["Archive","7Z"],tar:["Archive","TAR"],
    exe:["Application","APP"],msi:["Application","APP"],docx:["Document","DOC"],txt:["Document","DOC"],md:["Document","DOC"]
  };
  const mimeTypes = {
    "video/mp4":["Video","mp4","VID"],"video/webm":["Video","webm","VID"],"video/quicktime":["Video","mov","VID"],
    "video/x-matroska":["Video","mkv","VID"],"audio/mpeg":["Audio","mp3","AUD"],"audio/mp4":["Audio","m4a","AUD"],
    "audio/wav":["Audio","wav","AUD"],"audio/ogg":["Audio","ogg","AUD"],"image/jpeg":["Image","jpg","IMG"],
    "image/png":["Image","png","IMG"],"image/webp":["Image","webp","IMG"],"image/gif":["Image","gif","IMG"],
    "image/avif":["Image","avif","IMG"],"application/pdf":["PDF document","pdf","PDF"],
    "application/zip":["Archive","zip","ZIP"],"application/x-rar-compressed":["Archive","rar","ZIP"]
  };
  const interruptedReasons = {
    NETWORK_FAILED:"Network error",SERVER_FAILED:"Server error",FILE_FAILED:"File write error",
    FILE_ACCESS_DENIED:"Access denied",FILE_NO_SPACE:"Not enough disk space",
    FILE_NAME_TOO_LONG:"Filename too long",FILE_TOO_LARGE:"File too large",
    FILE_VIRUS_INFECTED:"Blocked by security software",USER_CANCELED:"Cancelled",
    USER_SHUTDOWN:"Browser closed"
  };

  function mimeOf(item) {
    return String(item.mime || item.mimeType || "").split(";")[0].trim().toLowerCase();
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
  function classify(name, item) {
    const match = /\.([^.]+)$/.exec(name);
    const extension = match ? match[1].toLowerCase() : "";
    if (types[extension]) return types[extension];
    const mime = mimeTypes[mimeOf(item)];
    if (mime) return [mime[0],mime[2]];
    const broad = mimeOf(item).split("/")[0];
    if (broad === "video") return ["Video","VID"];
    if (broad === "audio") return ["Audio","AUD"];
    if (broad === "image") return ["Image","IMG"];
    return ["File","FILE"];
  }
  function displayName(item) {
    const name = fileName(item);
    if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
    const mime = mimeTypes[mimeOf(item)];
    return mime ? (name + "." + mime[1]) : name;
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
  function status(item) {
    if (item.state === "complete") return "Completed";
    if (item.state === "interrupted") {
      const reason = interruptedReasons[item.error] || "Download interrupted";
      return reason;
    }
    return "In progress";
  }
  function render(item) {
    const name = displayName(item);
    const kind = classify(name,item);
    const state = status(item);
    const received = Number(item.bytesReceived) >= 0 ? Number(item.bytesReceived) : 0;
    const total = Number(item.totalBytes) > 0 ? Number(item.totalBytes) : 0;
    const bytes = total || received;
    const origin = host(item.finalUrl || item.url);
    const row = document.createElement("div");
    row.className = "download-row";
    row.setAttribute("role","group");
    row.setAttribute("aria-label",[name,kind[0],size(bytes),state,origin].join(", "));
    const open = document.createElement("button");
    open.type = "button";
    open.className = "download-open";
    open.setAttribute("aria-label","Show " + name + " in browser downloads");
    open.title = name + "\n" + kind[0] + " · " + size(bytes) + " · " + state +
      "\nSource: " + origin + (mimeOf(item) ? "\nType: " + mimeOf(item) : "");
    const icon = document.createElement("span");
    icon.className = "download-icon"; icon.textContent = kind[1];
    const info = document.createElement("span"); info.className = "download-content";
    const title = document.createElement("span"); title.className = "download-name"; title.textContent = name;
    const meta = document.createElement("span"); meta.className = "download-meta";
    meta.textContent = kind[0] + " · " + size(bytes) + " · " + state;
    info.append(title,meta);
    if (item.state === "in_progress" && total > 0) {
      const progress = document.createElement("span");
      progress.className = "download-progress";
      const fill = document.createElement("span");
      fill.style.width = Math.max(0,Math.min(100,received / total * 100)) + "%";
      progress.append(fill);
      info.append(progress);
    }
    const hover = document.createElement("span");
    hover.className = "download-hover";
    const date = item.startTime ? new Date(item.startTime).toLocaleString() : "Date unknown";
    hover.textContent = "Source: " + origin + " · " + (mimeOf(item) || kind[0]) + " · " + date;
    info.append(hover);
    const chevron = document.createElement("span");
    chevron.className = "download-chevron"; chevron.setAttribute("aria-hidden","true");
    chevron.textContent = "›";
    open.append(icon,info,chevron);
    open.addEventListener("click",() => {
      try {
        if (api.downloads?.show)
          void Promise.resolve(api.downloads.show(item.id)).catch(() => {});
        else if (api.tabs?.create)
          void Promise.resolve(api.tabs.create({url:"chrome://downloads/"})).catch(() => {});
      } catch { /* The browser may have already removed this history entry. */ }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "download-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label","Remove " + name + " from recent downloads");
    remove.title = "Remove from this list";
    remove.addEventListener("click",(event) => {
      event.stopPropagation();
      void hideRecentItem(item.id);
    });
    row.append(open,remove);
    return row;
  }

  async function refreshRecent() {
    const list = byId("recent-downloads");
    if (!list) return;
    if (refreshing) { refreshQueued = true; return; }
    if (!api.downloads?.search) {
      recentItems = [];
      list.textContent = "Browser download history is unavailable.";
      return;
    }
    refreshing = true;
    try {
      const [items,stored] = await Promise.all([
        api.downloads.search({limit:100,orderBy:["-startTime"]}),
        api.storage.local.get([recent.CLEARED_BEFORE_KEY,recent.HIDDEN_IDS_KEY])
      ]);
      const state = recent.fromStorage(stored);
      recentItems = recent.visible(items,state).slice(0,18);
      const fragment = document.createDocumentFragment();
      for (const item of recentItems) fragment.append(render(item));
      if (!recentItems.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No recent downloads. New downloads will appear here.";
        fragment.append(empty);
      }
      list.replaceChildren(fragment);
    } catch {
      list.textContent = "Could not read recent browser downloads.";
    } finally {
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refreshRecent();
      }
    }
  }

  async function hideRecentItem(id) {
    try {
      const saved = await api.storage.local.get([recent.CLEARED_BEFORE_KEY,recent.HIDDEN_IDS_KEY]);
      const next = recent.hide(recent.fromStorage(saved),id);
      await api.storage.local.set({
        [recent.CLEARED_BEFORE_KEY]:next.clearedBefore,
        [recent.HIDDEN_IDS_KEY]:next.hiddenIds
      });
      await refreshRecent();
    } catch (error) {
      byId("message").textContent = "Could not remove this item: " + error.message;
    }
  }

  async function clearRecent() {
    const clearButton = byId("confirm-clear-recent");
    clearButton.disabled = true;
    try {
      const saved = await api.storage.local.get([recent.CLEARED_BEFORE_KEY,recent.HIDDEN_IDS_KEY]);
      const next = recent.clear(recent.fromStorage(saved),recentItems,Date.now());
      await api.storage.local.set({
        [recent.CLEARED_BEFORE_KEY]:next.clearedBefore,
        [recent.HIDDEN_IDS_KEY]:next.hiddenIds
      });
      byId("clear-recent-confirm").hidden = true;
      byId("message").textContent = "Recent list cleared. Downloaded files were not deleted.";
      await refreshRecent();
    } catch (error) {
      byId("message").textContent = "Could not clear recent downloads: " + error.message;
    } finally { clearButton.disabled = false; }
  }

  async function initialize() {
    for (const tab of document.querySelectorAll("[data-view]")) {
      tab.addEventListener("click",() => openView(tab.dataset.view));
      tab.addEventListener("keydown",(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = views.indexOf(tab.dataset.view);
        const next = (index + (event.key === "ArrowRight" ? 1 : 2)) % views.length;
        openView(views[next]);
        document.querySelector('[data-view="' + views[next] + '"]').focus();
      });
    }
    byId("refresh-recent")?.addEventListener("click",refreshRecent);
    byId("clear-recent")?.addEventListener("click",() => {
      byId("clear-recent-confirm").hidden = false;
      byId("confirm-clear-recent").focus();
    });
    byId("cancel-clear-recent")?.addEventListener("click",() => {
      byId("clear-recent-confirm").hidden = true;
      byId("clear-recent").focus();
    });
    byId("confirm-clear-recent")?.addEventListener("click",clearRecent);
    openView("downloads");
    const master = byId("extension-enabled");
    const automatic = byId("automatic-capture");
    const cookie = byId("include-site-cookies");
    const saved = await api.storage.local.get([prefs.enabledKey]);
    master.checked = saved[prefs.enabledKey] !== false;
    const applyEnabled = (enabled) => {
      document.body.classList.toggle("extension-off",!enabled);
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
    master.addEventListener("change",async () => {
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
    api.storage.onChanged.addListener((changes,area) => {
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
