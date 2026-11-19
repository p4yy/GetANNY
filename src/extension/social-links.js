(() => {
  function socialSite(value) {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return null;
      const host = url.hostname.replace(/^(?:www|m)\./, "");
      if (host === "youtube.com") return "youtube";
      if (host === "instagram.com") return "instagram";
      if (host === "tiktok.com") return "tiktok";
      if (host === "dribbble.com") return "dribbble";
      if (["x.com", "twitter.com"].includes(host)) return "x";
    } catch {
      // Browser UI and extension pages have no social media links.
    }
    return null;
  }

  function postLink(href, page) {
    const site = socialSite(page);
    if (!site) return null;
    const link = new URL(href, page);
    if (socialSite(link.href) !== site) return null;
    const path = link.pathname.replace(/\/$/, "");
    const clean = (prefix) => "https://" + prefix + path;
    switch (site) {
      case "youtube": {
        const id =
          path === "/watch"
            ? link.searchParams.get("v")
            : /^\/(?:shorts|live)\/([\w-]+)$/.exec(path)?.[1];
        return /^[\w-]{11}$/.test(id || "")
          ? "https://www.youtube.com/watch?v=" + id
          : null;
      }
      case "instagram":
        return /^\/(?:reels?|p|tv)\/[\w-]+$/.test(path)
          ? "https://www.instagram.com/" +
              path.slice(1).replace(/^reels\//, "reel/") +
              "/"
          : null;
      case "tiktok":
        return /^\/@[\w.-]+\/video\/\d+$/.test(path)
          ? clean("www.tiktok.com")
          : null;
      case "dribbble":
        return /^\/shots\/\d+(?:-[\w-]+)?$/i.test(path)
          ? clean("dribbble.com")
          : null;
      case "x":
        return /^\/(?:[\w]+\/status|i\/web\/status)\/\d+$/.test(path)
          ? "https://x.com/i/web/status/" + path.split("/").at(-1)
          : null;
      default:
        return null;
    }
  }

  // TikTok's endless feed often keeps the address bar at /en/ while playing
  // independent blob: media. Derive only a post URL belonging to the media
  // element's own card, never the generic feed URL or an unrelated post.
  function postForMediaElement(video, page) {
    if (socialSite(page) !== "tiktok") return null;
    return postLink(page, page) || postForCard(video, page);
  }

  function postForCard(video, page) {
    let node = video;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const selfHref = node.getAttribute?.("href");
      if (selfHref) {
        const own = postLink(selfHref, page);
        if (own) return own;
      }
      if (!node.querySelectorAll) continue;
      // Reject a common ancestor containing several distinct video cards.
      if (node.querySelectorAll("video").length > 1) return null;
      const candidates = new Set();
      for (const link of node.querySelectorAll("a[href]")) {
        const href = link.getAttribute?.("href") || link.href;
        try {
          const post = postLink(href, page);
          if (post) candidates.add(post);
        } catch {}
        if (candidates.size > 1) return null;
      }
      if (candidates.size === 1) return [...candidates][0];
    }
    return null;
  }

  function contextPost(href, page, card) {
    const linked = href && postLink(href, href);
    return linked || card || (!href && postLink(page, page)) || null;
  }

  function dribbbleAsset(raw, page) {
    if (!raw) return null;
    try {
      const url = new URL(raw, page);
      if (url.protocol === "https:" && !url.username && !url.password &&
          /(^|\.)dribbble\.com$/i.test(url.hostname) && /\.(mp4|webm|mov)$/i.test(url.pathname)) return url.href;
    } catch {}
    return null;
  }

  const links = { socialSite, postLink, postForMediaElement, postForCard, contextPost, dribbbleAsset };
  globalThis.GetANNYSocialLinks = links;
  if (typeof module === "object" && module.exports) module.exports = links;
})();
