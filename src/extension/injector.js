(() => {
  const api = globalThis.browser || globalThis.chrome;
  const provider =
    /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com|soundcloud\.com)$/i.test(
      location.hostname,
    );
  const dismissed = new Set();
  const preferences = globalThis.GetANNYOverlayPreferences;
  const storage = api.storage.sync || api.storage.local;
  let preferenceKey = preferences.siteKey(location.href);
  let preference = {};
  let current, host, button, close, frame, theme, drag;
  const size = () => ({ width: host.offsetWidth, height: host.offsetHeight });
  const viewport = () => ({ width: innerWidth, height: innerHeight });
  async function loadPreference() {
    try {
      const response = await api.runtime
        .sendMessage({ type: "overlay-site" })
        .catch(() => null);
      preferenceKey = preferences.siteKey(response?.site) || preferenceKey;
      if (preferenceKey)
        preference = (await storage.get(preferenceKey))[preferenceKey] || {};
    } catch {
      // The overlay remains usable if storage or the background is unavailable.
    }
    if (host) schedule();
  }
  void loadPreference();
  api.storage.onChanged.addListener((changes, area) => {
    if (
      area === (api.storage.sync ? "sync" : "local") &&
      changes[preferenceKey]
    ) {
      preference = changes[preferenceKey].newValue || {};
      if (host) schedule();
    }
  });
  async function savePosition(position) {
    if (!preferenceKey) return;
    try {
      const latest = (await storage.get(preferenceKey))[preferenceKey] || {};
      await storage.set({ [preferenceKey]: { ...latest, position } });
    } catch {
      // Keep the new coordinates for the current session.
    }
  }
  // The floating button mirrors the desktop palette. Custom properties
  // inherit into the shadow root, so painting the host is enough.
  const paint = (value) => {
    if (!value || typeof value !== "object" || !value.colors) return;
    theme = value;
    if (!host) return;
    const tokens = {
      "--ga-bg": "--panel",
      "--ga-raised": "--raised",
      "--ga-border": "--line",
      "--ga-close-bg": "--sidebar",
      "--ga-text": "--text",
      "--ga-close-text": "--secondary",
      "--ga-accent": "--accent",
      "--ga-accent-text": "--accent-text",
    };
    for (const [name, token] of Object.entries(tokens)) {
      const color = value.colors?.[token];
      if (color) host.style.setProperty(name, color);
    }
  };
  try {
    api.storage.local
      .get(["getannyTheme"])
      .then((saved) => paint(saved.getannyTheme));
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.getannyTheme)
        paint(changes.getannyTheme.newValue);
    });
  } catch {
    /* theme sync is optional when storage is unavailable */
  }
  const key = () => {
    const url = new URL(location.href);
    const video = url.searchParams.get("v");
    return /(^|\.)youtube\.com$/i.test(location.hostname) && video
      ? `youtube:${video}`
      : `${url.origin}${url.pathname}`;
  };
  const isDismissed = () => {
    const id = key();
    if (dismissed.has(id)) return true;
    try {
      return sessionStorage.getItem(`getanny-overlay:${id}`) === "1";
    } catch {
      return false;
    }
  };
  function ensure() {
    if (host) return;
    let logo = "icons/icon48.png";
    try {
      logo = api.runtime.getURL("icons/icon48.png");
    } catch {
      /* keep a relative resource path if the API is unavailable */
    }
    host = document.createElement("div");
    host.style.cssText =
      "position:fixed;z-index:2147483646;display:none;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      .wrap{display:flex;align-items:center;gap:4px;pointer-events:auto;font-family:system-ui,-apple-system,sans-serif}
      button{all:initial;box-sizing:border-box;display:flex;align-items:center;justify-content:center;height:28px;background:var(--ga-bg,#151d24ef);color:var(--ga-text,#e8f0f2);border:1px solid var(--ga-border,#40515c);cursor:pointer;font:600 11px/1 system-ui,-apple-system,sans-serif;transition:background .12s,border-color .12s,color .12s}
      .send{gap:5px;padding:0 8px;border-radius:6px;box-shadow:0 2px 8px #0004;white-space:nowrap}
      .logo{width:15px;height:15px;object-fit:contain;display:block;flex:none}
      .move{width:22px;border-radius:6px;touch-action:none;cursor:grab}
      .move:active{cursor:grabbing}
      .dismiss{width:22px;height:22px;margin-inline-start:1px;border-radius:50%;background:var(--ga-close-bg,#151d24d9);color:var(--ga-close-text,#b9c5cc);font-size:14px;font-weight:400}
      button:hover{background:var(--ga-raised,#24323b);border-color:var(--ga-accent,#a2dfc2);color:var(--ga-text,#fff)}
      button:focus-visible{outline:2px solid var(--ga-accent,#a2dfc2);outline-offset:2px}
      button:disabled{opacity:.65;cursor:wait}
      @media(prefers-reduced-motion:reduce){button{transition:none}}
    </style><div class="wrap"><button class="move" type="button" aria-label="Move GetANNY" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" title="Drag to move">⠿</button><button class="send" type="button" aria-label="Send media to GetANNY"><img class="logo" alt="" src="${logo}" draggable="false"><span class="label">GetANNY</span></button><button class="dismiss" type="button" aria-label="Dismiss GetANNY for this video" title="Dismiss for this video">×</button></div>`;
    document.documentElement.appendChild(host);
    paint(theme);
    button = shadow.querySelector(".send");
    close = shadow.querySelector(".dismiss");
    button.addEventListener("click", send);
    const move = shadow.querySelector(".move");
    const setPosition = (point) => {
      preference = {
        ...preference,
        position: preferences.position(point, viewport(), size()),
      };
      schedule();
    };
    move.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || drag) return;
      const box = host.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        previous: preference.position,
      };
      move.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    move.addEventListener("pointermove", (event) => {
      if (event.pointerId === drag?.id)
        setPosition({ x: event.clientX - drag.x, y: event.clientY - drag.y });
    });
    move.addEventListener("pointerup", (event) => {
      if (event.pointerId !== drag?.id) return;
      drag = null;
      if (preference.position) void savePosition(preference.position);
    });
    move.addEventListener("pointercancel", () => {
      if (!drag) return;
      preference = { ...preference, position: drag.previous };
      drag = null;
      schedule();
    });
    move.addEventListener("keydown", (event) => {
      const delta = {
        ArrowLeft: [-12, 0],
        ArrowRight: [12, 0],
        ArrowUp: [0, -12],
        ArrowDown: [0, 12],
      }[event.key];
      if (!delta) return;
      event.preventDefault();
      const box = host.getBoundingClientRect();
      setPosition({ x: box.left + delta[0], y: box.top + delta[1] });
      void savePosition(preference.position);
    });
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = key();
      dismissed.add(id);
      try {
        sessionStorage.setItem(`getanny-overlay:${id}`, "1");
      } catch {
        /* in-memory dismissal still covers this viewing session */
      }
      hide();
    });
  }
  function hide() {
    if (host) host.style.display = "none";
  }
  function place() {
    frame = null;
    if (!host) return;
    if (
      !current?.isConnected ||
      preference.hidden ||
      isDismissed() ||
      document.fullscreenElement
    ) {
      hide();
      return;
    }
    const box = current.getBoundingClientRect();
    if (
      box.width < 180 ||
      box.height < 100 ||
      box.bottom < 40 ||
      box.top > innerHeight - 40
    ) {
      hide();
      return;
    }
    host.style.display = "block";
    if (preference.position) {
      const offset = preferences.offset(
        preference.position,
        viewport(),
        size(),
      );
      host.style.top = `${offset.y}px`;
      host.style.left = `${offset.x}px`;
      return;
    }
    const width = host.offsetWidth || 112;
    host.style.top = `${Math.max(6, box.top + 8)}px`;
    host.style.left = `${Math.max(6, Math.min(innerWidth - width - 6, box.right - width - 8))}px`;
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(place);
  }
  function activate(video) {
    if (isDismissed()) return;
    ensure();
    current = video;
    schedule();
  }
  document.addEventListener(
    "pointerover",
    (event) => {
      if (event.target instanceof HTMLVideoElement) activate(event.target);
    },
    true,
  );
  document.addEventListener(
    "play",
    (event) => {
      if (event.target instanceof HTMLVideoElement) activate(event.target);
    },
    true,
  );
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  document.addEventListener("fullscreenchange", schedule);
  document.addEventListener("yt-navigate-finish", () => {
    current = null;
    hide();
  });
  async function send() {
    if (!current) return;
    const source = current.currentSrc || current.src;
    const isTikTok = globalThis.GetANNYSocialLinks.socialSite(location.href) === "tiktok";
    const post = isTikTok
      ? globalThis.GetANNYSocialLinks.postForMediaElement(current, location.href)
      : null;
    if (isTikTok && !post) {
      shadowLabel("Open video link");
      button.title = "TikTok did not expose this video's post link. Open the individual post or copy its link.";
      setTimeout(() => shadowLabel("GetANNY"), 3000);
      return;
    }
    const manifest =
      /^https?:\/\//.test(source) && /\.(?:m3u8|mpd)(?:$|[?#])/i.test(source);
    const media = isTikTok || manifest || provider || !/^https?:\/\//.test(source);
    button.disabled = true;
    shadowLabel("Sending…");
    try {
      const result = await api.runtime.sendMessage({
        type: "download",
        url: post || (manifest ? source : media ? location.href : source),
        kind: media ? "media" : "file",
      });
      shadowLabel(result?.success ? "Sent ✓" : "Unavailable");
      button.title = result?.error || "Open GetANNY to manage this request.";
    } catch (error) {
      shadowLabel("Open GetANNY");
      button.title = error.message;
    } finally {
      button.disabled = false;
      setTimeout(() => shadowLabel("GetANNY"), 2500);
    }
  }
  function shadowLabel(text) {
    const label = button?.querySelector(".label");
    if (label) label.textContent = text;
  }
})();
