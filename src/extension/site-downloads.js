(() => {
  function providerFor(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return null;
      const host = url.hostname;
      if (["chatgpt.com", "chat.openai.com"].includes(host)) return "ChatGPT";
      if (host === "claude.ai") return "Claude";
      if (["www.perplexity.ai", "perplexity.ai"].includes(host))
        return "Perplexity";
      if (["suno.com", "www.suno.com", "app.suno.ai"].includes(host))
        return "Suno";
      if (host === "gemini.google.com") return "Gemini";
      if (host === "copilot.microsoft.com") return "Copilot";
    } catch {}
    return null;
  }

  function classifyOutput(page, target, mime = "", disposition = "") {
    const provider = providerFor(page);
    if (!provider) return null;
    const url = new URL(target);
    if (url.protocol !== "https:") return null;
    if (
      provider === "Suno" &&
      /^cdn[0-9]*\.(?:suno\.ai|suno\.com)$/.test(url.hostname) &&
      (/^audio\//i.test(mime) || /\.(?:mp3|wav|m4a)$/i.test(url.pathname))
    )
      return { kind: "file", title: "Suno audio" };
    if (/\battachment\b/i.test(disposition))
      return { kind: "file", title: provider + " file" };
    if (
      provider === "ChatGPT" &&
      /^(?:files\.oaiusercontent\.com|persistent\.oaistatic\.com)$/.test(
        url.hostname,
      ) &&
      /^image\//i.test(mime)
    )
      return { kind: "file", title: "ChatGPT image" };
    return null;
  }

  const adapters = { providerFor, classifyOutput };
  globalThis.GetANNYSiteDownloads = adapters;
  if (typeof module === "object" && module.exports) module.exports = adapters;
})();
