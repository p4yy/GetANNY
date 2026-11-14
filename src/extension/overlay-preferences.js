(() => {
  function siteKey(address) {
    try {
      const url = new URL(address);
      if (["https:", "http:"].includes(url.protocol))
        return `getanny-overlay:${url.hostname.toLowerCase()}`;
    } catch {
      // Internal browser pages do not have an overlay preference.
    }
    return null;
  }

  function fraction(value) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  function offset(position, viewport, size) {
    const horizontal = Math.max(0, viewport.width - size.width);
    const vertical = Math.max(0, viewport.height - size.height);
    return {
      x: fraction(position.x) * horizontal,
      y: fraction(position.y) * vertical,
    };
  }

  function position(pixels, viewport, size) {
    return {
      x: fraction(pixels.x / Math.max(1, viewport.width - size.width)),
      y: fraction(pixels.y / Math.max(1, viewport.height - size.height)),
    };
  }

  const preferences = { siteKey, offset, position };
  globalThis.GetANNYOverlayPreferences = preferences;
  if (typeof module === "object" && module.exports)
    module.exports = preferences;
})();
