(() => {
  const api = globalThis.browser || globalThis.chrome;
  const seen = new Set();
  // Keep a bounded independent record: the background can lose initial
  // reports during tab navigation or service-worker restoration.
  const observedMedia = new Map();
  const socialLinks = new Set();
  if (globalThis.GetANNYSiteDownloads.providerFor(location.href)) {
    document.addEventListener(
      "click",
      (event) => {
        if (
          !event.isTrusted ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey
        )
          return;
        const link = event.target.closest?.("a[download]");
        if (!link || !link.href.startsWith("blob:")) return;
        const url = new URL(link.href);
        if (url.origin !== location.origin) return;
        event.preventDefault();
        transferBlob(url.href, link.download || "browser-file").catch(() => {
          // A rejected or oversized payload is still available to the browser.
          const native = document.createElement("a");
          native.href = url.href;
          native.download = link.download || "browser-file";
          document.body.append(native);
          native.click();
          native.remove();
        });
      },
      true,
    );
  }

  async function transferBlob(url, filename) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Browser file is no longer available.");
    // Blob URLs frequently omit Content-Length. Number(null) is zero, which
    // previously produced an empty desktop file for a nonempty browser Blob.
    // Reject a declared oversize response early, then trust the actual Blob
    // length before allocating an upload or sending any chunks.
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      const reported = Number(declared);
      if (!Number.isSafeInteger(reported) || reported < 0 || reported > 64 * 1024 * 1024)
        throw new Error("This file exceeds GetANNY’s browser handoff limit.");
    }
    const blob = await response.blob();
    const length = blob.size;
    if (!Number.isSafeInteger(length) || length > 64 * 1024 * 1024)
      throw new Error("This file exceeds GetANNY’s browser handoff limit.");
    const send = async (message) => {
      const result = await api.runtime.sendMessage({
        type: "browser-payload",
        ...message,
      });
      if (!result || result.success === false)
        throw new Error(result?.error || "Desktop unavailable.");
      return result;
    };
    const { uploadId } = await send({
      action: "begin",
      filename: filename.slice(0, 220),
      length,
    });
    try {
      for (let offset = 0; offset < length; offset += 48 * 1024) {
        const bytes = new Uint8Array(
          await blob.slice(offset, offset + 48 * 1024).arrayBuffer(),
        );
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await send({ action: "chunk", uploadId, offset, data: btoa(binary) });
      }
      await send({ action: "finish", uploadId });
    } catch (error) {
      await send({ action: "abort", uploadId }).catch(() => {});
      throw error;
    }
  }
  const isTikTok = globalThis.GetANNYSocialLinks.socialSite(location.href) === "tiktok";
  const social =
    window === window.top &&
    globalThis.GetANNYSocialLinks.socialSite(location.href);
  let socialPage = location.href;
  function rememberPosts(root) {
    if (!social) return;
    if (location.href !== socialPage) {
      socialPage = location.href;
      socialLinks.clear();
    }
    const anchors = root.matches?.("a[href]")
      ? [root]
      : root.querySelectorAll?.("a[href]") || [];
    for (const anchor of anchors) {
      try {
        const url = globalThis.GetANNYSocialLinks.postLink(
          anchor.href,
          location.href,
        );
        if (url) socialLinks.add(url);
      } catch {}
      if (socialLinks.size >= 500) break;
    }
  }
  if (social)
    api.runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id !== api.runtime.id || message.type !== "social-links")
        return;
      rememberPosts(document);
      respond({ links: [...socialLinks] });
    });
  const send = (media) => {
    if (!media.url || seen.has(media.url)) return;
    try {
      const url = new URL(media.url, location.href);
      if (!["http:", "https:"].includes(url.protocol)) return;
      observedMedia.set(url.href, {
        ...media,
        url: url.href,
        title: document.title,
      });
      if (observedMedia.size > 100)
        observedMedia.delete(observedMedia.keys().next().value);
      if (seen.has(url.href)) return;
      seen.add(url.href);
      // Media-heavy long-lived pages must not grow this cache indefinitely.
      if (seen.size > 100) seen.delete(seen.values().next().value);
      api.runtime
        .sendMessage({
          type: "media-detected",
          media: { ...media, url: url.href, title: document.title },
        })
        .catch(() => {});
    } catch {
      /* non-downloadable URL */
    }
  };
  function activeTikTokPost() {
    const direct = globalThis.GetANNYSocialLinks.postLink(location.href, location.href);
    if (direct) return direct;
    const videos = [...document.querySelectorAll("video")];
    const playing = videos.filter((video) => !video.paused && !video.ended);
    // Prefer the one playing video. Never guess from multiple feed cards.
    const target = playing.length === 1 ? playing[0] :
      videos.length === 1 ? videos[0] : null;
    return target
      ? globalThis.GetANNYSocialLinks.postForMediaElement(target, location.href)
      : null;
  }
  function element(root) {
    if (!(root instanceof Element)) return;
    if (root.matches("video,audio")) {
      if (isTikTok && root.matches("video")) {
        const post = globalThis.GetANNYSocialLinks.postForMediaElement(root, location.href);
        // Never advertise /en/ (or another TikTok feed URL) as a video.
        if (post) {
          send({ url: post, kind: "media" });
          const streamUrl = root.currentSrc || root.src || "";
          // Only a known direct file URL is ready for instant playback
          // capture. blob:, manifest and fragment URLs still use yt-dlp.
          const match = /\\.(mp4|webm)(?:$|[?#])/i.exec(streamUrl);
          if (/^https:\/\//i.test(streamUrl) && match)
            api.runtime.sendMessage({
              type: "getanny:playback-captured",
              postUrl: post,
              streamUrl,
              mimeType: match[1].toLowerCase() === "webm"
                ? "video/webm" : "video/mp4",
              title: document.title,
            }).catch(() => {});
        }
        return;
      }
      const url = root.currentSrc || root.src;
      if (url && !url.startsWith("blob:")) send({ url, kind: "file" });
      else send({ url: location.href, kind: "media" });
    }
    if (root.matches("source") && root.parentElement?.matches("video,audio")) {
      // Some TikTok players expose low-quality transient CDN sources. Prefer
      // the post permalink, which allows Media Studio to inspect all formats.
      if (isTikTok && root.parentElement.matches("video")) return;
      send({
        url: root.src,
        mimeType: root.type,
        kind: /mpegurl|dash/.test(root.type) ? "media" : "file",
      });
    }
  }
  function scan(root = document) {
    element(root);
    rememberPosts(root);
    if (root.querySelectorAll)
      for (const node of root.querySelectorAll("video,audio,source"))
        element(node);
  }
  // The extension popup may ask the page for another scan if the initial
  // media report was dropped. Do not service messages from other extensions.
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    if (message?.type === "getanny:active-post") {
      respond({ url: isTikTok ? activeTikTokPost() : null });
      return;
    }
    if (message?.type !== "getanny:scan-media") return;
    scan();
    respond({ items: [...observedMedia.values()] });
  });
  const pending = new Set();
  let timer;
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Only newly inserted subtrees are scanned, never the whole document on
        // every mutation. Coalesce framework bursts into one inexpensive pass.
        if (pending.size < 100) pending.add(node);
      }
    if (!pending.size) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const node of pending) scan(node);
      pending.clear();
    }, 300);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("play", (event) => scan(event.target), true);
  scan();
})();
