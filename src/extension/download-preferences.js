(() => {
  const automaticKey = "getannyAutomaticHandoff";
  const enabledKey = "getannyExtensionEnabled";
  const siteKey = (kind, url) => {
    try {
      const parsed = new URL(url);
      if (/^https?:$/.test(parsed.protocol))
        return `getanny:downloads:${kind}:${parsed.hostname}`;
    } catch {
      /* Browser settings pages have no HTTP(S) hostname. */
    }
    return null;
  };

  async function get(api, sourceUrl, downloadUrl = sourceUrl) {
    const keepKey = siteKey("keep", sourceUrl);
    const cookieKey = siteKey("cookies", downloadUrl);
    const saved = await api.storage.local.get(
      [enabledKey, automaticKey, keepKey, cookieKey].filter(Boolean),
    );
    const enabled = saved[enabledKey] !== false;
    return {
      enabled,
      automatic: enabled && saved[automaticKey] !== false,
      keepInBrowser: Boolean(keepKey && saved[keepKey] === true),
      // Only the per-site preference is stored, never any cookie value.
      includeSiteCookies: enabled && Boolean(cookieKey && saved[cookieKey] !== false),
    };
  }

  globalThis.GetANNYDownloadPreferences = { enabledKey, automaticKey, siteKey, get };
})();
