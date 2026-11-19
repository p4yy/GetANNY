(() => {
  const automaticKey = "getannyAutomaticHandoff";
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
      [automaticKey, keepKey, cookieKey].filter(Boolean),
    );
    return {
      automatic: saved[automaticKey] !== false,
      keepInBrowser: Boolean(keepKey && saved[keepKey] === true),
      includeSiteCookies: Boolean(cookieKey && saved[cookieKey] === true),
    };
  }

  globalThis.GetANNYDownloadPreferences = { automaticKey, siteKey, get };
})();
