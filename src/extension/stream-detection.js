(() => {
  function classifyMediaResponse(url, type) {
    const mime = String(type || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    let pathname;
    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch {
      return null;
    }
    if (
      pathname.endsWith(".m3u8") ||
      /^(?:application|audio)\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl)$/.test(
        mime,
      )
    )
      return { kind: "media", stream: "hls" };
    if (pathname.endsWith(".mpd") || mime === "application/dash+xml")
      return { kind: "media", stream: "dash" };
    if (
      mime === "video/mp2t" ||
      (pathname.endsWith(".ts") &&
        (!mime || mime === "application/octet-stream"))
    )
      return { kind: "file", stream: "hls-fragment" };
    if (/^(?:video|audio)\//.test(mime)) return { kind: "file" };
    return null;
  }

  function sameStreamDirectory(manifest, fragment) {
    if (manifest.frameId !== fragment.frameId) return false;
    const source = new URL(manifest.url);
    const part = new URL(fragment.url);
    return (
      source.origin === part.origin &&
      part.pathname.startsWith(
        source.pathname.slice(0, source.pathname.lastIndexOf("/") + 1),
      )
    );
  }

  // Keep a bounded URL history per playlist so Range requests and retries for
  // the same TS file do not inflate the count in the media picker.
  function recordFragment(manifest, fragment) {
    const url = new URL(fragment.url);
    url.hash = "";
    const recent = manifest.recentFragments || [];
    if (recent.includes(url.href)) return false;
    manifest.recentFragments = [...recent.slice(-255), url.href];
    manifest.fragmentCount = Math.min(10000, (manifest.fragmentCount || 0) + 1);
    return true;
  }

  function bestManifest(entries, fragment) {
    let match;
    let specificity = 0;
    for (const entry of entries) {
      if (entry.stream !== "hls" || !sameStreamDirectory(entry, fragment))
        continue;
      const depth = new URL(entry.url).pathname.lastIndexOf("/") + 1;
      if (depth > specificity) {
        match = entry;
        specificity = depth;
      }
    }
    return match;
  }

  function addDetection(existing, item, limit) {
    const next = existing.map((entry) => ({ ...entry }));
    const duplicate = next.findIndex(
      (entry) => entry.url === item.url && entry.frameId === item.frameId,
    );
    if (duplicate !== -1) {
      if (item.stream && item.stream !== next[duplicate].stream) {
        Object.assign(next[duplicate], item);
        item = next.splice(duplicate, 1)[0];
      } else return existing;
    }
    if (item.stream === "hls-fragment") {
      const manifest = bestManifest(next, item);
      if (manifest) return recordFragment(manifest, item) ? next : existing;
    } else if (item.stream === "hls") {
      item.fragmentCount ||= 0;
      const manifests = [item, ...next];
      for (const entry of next) {
        if (entry.stream !== "hls" || !entry.recentFragments?.length) continue;
        entry.recentFragments = entry.recentFragments.filter((url) => {
          if (bestManifest(manifests, { url, frameId: entry.frameId }) !== item)
            return true;
          recordFragment(item, { url });
          entry.fragmentCount--;
          return false;
        });
      }
      for (let i = next.length - 1; i >= 0; i--) {
        const entry = next[i];
        if (
          entry.stream !== "hls-fragment" ||
          bestManifest(manifests, entry) !== item
        )
          continue;
        next.splice(i, 1);
        recordFragment(item, entry);
      }
    }
    next.unshift(item);
    // Preserve detected playlists when a long-lived tab emits many fragments.
    const isManifest = (entry) => ["hls", "dash"].includes(entry.stream);
    return [
      ...next.filter(isManifest),
      ...next.filter((entry) => !isManifest(entry)),
    ].slice(0, limit);
  }

  const detection = { classifyMediaResponse, addDetection };
  globalThis.GetANNYStreamDetection = detection;
  if (typeof module === "object" && module.exports) module.exports = detection;
})();
