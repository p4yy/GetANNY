/* Browser download handoff. Loaded before background.js in both extension families. */
(() => {
  const validUrl = (value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };
  const filename = (item, url) => {
    // Chrome normally supplies an absolute path; Firefox may supply a name.
    const nativeName = String(item.filename || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1);
    if (nativeName) return nativeName;
    // Do not make a URL segment authoritative: Content-Disposition may still
    // provide a better name in the desktop engine.
    return undefined;
  };

  class GetANNYDownloadInterceptor {
    constructor({ api, request, onError = () => {} }) {
      this.api = api;
      this.request = request;
      this.onError = onError;
      this.entries = new Map();
      this.session = api.storage?.session;
      this.saveQueue = Promise.resolve();
      this.ready = Promise.resolve();
      this.listener = (item) => this.created(item).catch(this.onError);
    }

    start() {
      // MV3 service workers can be suspended between pausing a browser item
      // and receiving the desktop acknowledgement. Session storage survives a
      // worker restart, but is cleared by the browser between browser sessions.
      this.ready = this.restore();
      this.api.downloads?.onCreated.addListener(this.listener);
    }

    async save() {
      if (!this.session) return;
      const entries = [...this.entries.values()].map((entry) => ({ ...entry }));
      const write = this.saveQueue
        .catch(() => {})
        .then(() => this.session.set({ getannyHandoffs: entries }));
      this.saveQueue = write;
      await write;
    }

    async restore() {
      if (!this.session) return;
      const stored = await this.session.get("getannyHandoffs");
      for (const entry of Array.isArray(stored.getannyHandoffs)
        ? stored.getannyHandoffs
        : []) {
        if (
          !Number.isInteger(entry.downloadId) ||
          typeof entry.transferId !== "string"
        )
          continue;
        this.entries.set(entry.transferId, entry);
        if (!entry.requestStarted) {
          // A worker may die just after pause() but before recording it. Ask
          // the browser rather than assuming the item is still running.
          const matches = await this.api.downloads.search({
            id: entry.downloadId,
          });
          if (matches[0]?.state === "in_progress" && matches[0]?.paused) {
            entry.paused = true;
            if (!(await this.resumeEntry(entry))) {
              entry.stage = "restore-resume";
              continue;
            }
          }
          this.entries.delete(entry.transferId);
        }
      }
      await this.save();
    }

    stop() {
      this.api.downloads?.onCreated.removeListener(this.listener);
    }

    entry(id) {
      // Browser download IDs can be reused in another profile or after a
      // browser restart. They are not suitable as persistent desktop IDs.
      const existing = [...this.entries.values()].find(
        (entry) => entry.downloadId === id,
      );
      if (existing) return existing;
      const entry = {
        downloadId: id,
        transferId: crypto.randomUUID(),
        paused: false,
        stage: "preparing",
        requestStarted: false,
      };
      this.entries.set(entry.transferId, entry);
      return entry;
    }

    async pause(entry) {
      try {
        await this.api.downloads.pause(entry.downloadId);
        entry.paused = true;
      } catch (error) {
        // A short, completed, or non-resumable native transfer cannot be handed
        // off without risking two active copies. Keep it in the browser.
        entry.paused = false;
        entry.pauseError = error.message;
        throw new Error(
          `GetANNY left this download in the browser: ${error.message}`,
        );
      }
    }

    async privateContext(item) {
      if (
        !this.session ||
        !this.api.cookies?.getAllCookieStores ||
        !this.api.tabs?.query
      )
        return null;
      try {
        const allowed = this.api.extension?.isAllowedIncognitoAccess;
        if (allowed && !(await allowed.call(this.api.extension))) return null;
        const [tabs, stores] = await Promise.all([
          this.api.tabs.query({}),
          this.api.cookies.getAllCookieStores(),
        ]);
        const candidates = tabs.filter(
          (tab) =>
            tab.incognito === true &&
            (Number.isInteger(item.tabId)
              ? tab.id === item.tabId
              : item.cookieStoreId
                ? tab.cookieStoreId === item.cookieStoreId ||
                  stores.some(
                    (store) =>
                      store.id === item.cookieStoreId &&
                      store.tabIds?.includes(tab.id),
                  )
                : Boolean(item.referrer && tab.url === item.referrer)),
        );
        const matched = new Map();
        for (const tab of candidates) {
          for (const store of stores) {
            if (item.cookieStoreId && store.id !== item.cookieStoreId) continue;
            if (
              store.tabIds?.includes(tab.id) ||
              tab.cookieStoreId === store.id
            )
              matched.set(store.id, tab);
          }
        }
        if (matched.size !== 1) return null;
        const [storeId, tab] = matched.entries().next().value;
        return { storeId, tab };
      } catch {
        return null;
      }
    }

    async metadata(item, url, privateContext, siteCookies) {
      const headers = {};
      if (!privateContext && !item.referrer && this.api.tabs?.query) {
        try {
          const [tab] = await this.api.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (tab?.url && new URL(tab.url).origin === new URL(url).origin)
            headers.Referer = tab.url;
        } catch {
          /* no inferred cross-origin referrer */
        }
      }
      if (item.referrer && validUrl(item.referrer))
        headers.Referer = item.referrer;
      else if (privateContext && validUrl(privateContext.tab.url))
        headers.Referer = privateContext.tab.url;
      if (globalThis.navigator?.userAgent)
        headers["User-Agent"] = globalThis.navigator.userAgent;
      if (siteCookies && this.api.cookies?.getAll) {
        try {
          // Firefox containers and other cookie stores must not silently use
          // a different account's default-store cookies.
          const query = { url };
          const storeId = privateContext?.storeId || item.cookieStoreId;
          if (storeId) query.storeId = storeId;
          const cookies = await this.api.cookies.getAll(query);
          if (cookies.length)
            headers.Cookie = cookies
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; ");
        } catch (error) {
          if (privateContext)
            throw new Error(
              "GetANNY could not read the private cookie store.",
              { cause: error },
            );
          // A normal handoff can still succeed without cookies.
        }
      }
      return { headers, siteCookies };
    }

    async created(item) {
      await this.ready;
      const id = Number(item?.id);
      const url = validUrl(item?.finalUrl) ? item.finalUrl : item?.url;
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        [...this.entries.values()].some((entry) => entry.downloadId === id) ||
        item.byExtensionId === this.api.runtime.id ||
        !validUrl(url) ||
        (item.state && item.state !== "in_progress")
      )
        return;
      const prefs = await globalThis.GetANNYDownloadPreferences.get(
        this.api,
        validUrl(item.referrer) ? item.referrer : item.url,
        url,
      );
      if (!prefs.automatic || prefs.keepInBrowser) return;
      if (globalThis.GetANNYSiteDownloads?.prefersBrowser(item.referrer, url, prefs.includeSiteCookies)) return;
      const isPrivate = item.incognito === true;
      const privateContext = isPrivate ? await this.privateContext(item) : null;
      if (isPrivate && !privateContext) return;
      if ([...this.entries.values()].some((entry) => entry.downloadId === id)) return;
      const entry = this.entry(id);
      try {
        // Save the identity before pausing, so a restarted worker can return
        // an unsent request to the browser without guessing ownership.
        await this.save();
        await this.pause(entry);
        await this.save();
        const { headers, siteCookies } = await this.metadata(
          item,
          url,
          privateContext,
          prefs.includeSiteCookies,
        );
        if (entry.connectionLost)
          throw new Error("Desktop disconnected before the handoff began.");
        entry.requestStarted = true;
        await this.save();
        const result = await this.request({
          type: "download",
          kind: "file",
          url,
          filename: filename(item, url),
          headers,
          page: validUrl(item.referrer) ? item.referrer : undefined,
          includeSiteCookies: siteCookies,
          ...(isPrivate ? { privateSession: true } : {}),
          mimeType: item.mime || item.mimeType || null,
          intercepted: true,
          retainsBrowserCopy: Boolean(this.session && !isPrivate),
          transferId: entry.transferId,
        });
        if (result.action === "queued" || result.action === "completed") {
          entry.desktopQueued = true;
          if (result.action === "queued" && result.retainBrowserCopy) {
            entry.stage = "owned";
            await this.save();
          } else {
            await this.save();
            await this.cancel(entry.transferId);
            this.entries.delete(entry.transferId);
            await this.save();
          }
        } else if (result.action === "review") {
          // Keep the browser copy paused while the user reviews it in GetANNY.
          entry.stage = "review";
          await this.save();
        } else {
          throw new Error("GetANNY returned an unsupported handoff response.");
        }
      } catch (error) {
        if (entry.desktopQueued) {
          // GetANNY owns the transfer now. Never resume the native copy; retain
          // this entry so a later reconciliation can retry native cleanup.
          entry.stage = entry.stage === "cancelling" ? "cancelling" : "cleanup";
        } else if (entry.requestStarted && error.ambiguous) {
          entry.stage = "reconcile";
        } else {
          const resumed = await this.resumeEntry(entry);
          if (entry.paused && !resumed) entry.stage = "restore-resume";
          else this.entries.delete(entry.transferId);
        }
        await this.save().catch((failure) => this.onError(failure));
        this.onError(error);
      }
    }

    async cancel(transferId) {
      const entry = this.entries.get(String(transferId));
      if (!entry) throw new Error("Browser transfer is no longer available.");
      const id = entry.downloadId;
      if (entry?.stage !== "cancelling") {
        try {
          await this.api.downloads.cancel(id);
        } catch (error) {
          if (!this.api.downloads.search) throw error;
          const matches = await this.api.downloads.search({ id });
          if (matches[0]?.state === "in_progress") throw error;
        }
        entry.stage = "cancelling";
        await this.save();
      }
      // Remove only the browser history entry. Never delete an unknown file.
      await this.api.downloads.erase({ id });
      if (entry) entry.stage = "transferred";
    }

    async resumeEntry(entry) {
      if (!entry?.paused) return false;
      try {
        await this.api.downloads.resume(entry.downloadId);
        entry.paused = false;
        entry.stage = "browser";
        return true;
      } catch {
        // It may already have finished or been removed by the browser user.
        return false;
      }
    }

    async resume(transferId) {
      const entry = this.entries.get(String(transferId));
      const resumed = await this.resumeEntry(entry);
      if (entry?.paused && !resumed) return false;
      this.entries.delete(String(transferId));
      await this.save();
      return resumed;
    }

    async command(message) {
      await this.ready;
      if (message.action === "download-in-browser") {
        if (!validUrl(message.url))
          throw new Error("A valid download URL is required.");
        // The browser owns this transfer. Its byExtensionId bypasses interception,
        // preventing an endless return to the desktop after a site rejects it.
        const downloadId = await this.api.downloads.download({
          url: message.url,
          saveAs: true,
          conflictAction: "uniquify",
        });
        return { success: Number.isInteger(downloadId), browserManaged: true };
      }
      const transferId = String(message.transferId || "");
      if (!this.entries.has(transferId)) {
        // Commands are idempotent after a worker restart or duplicate response.
        return { success: true, missing: true };
      }
      if (message.action === "cancel") {
        await this.cancel(transferId);
        this.entries.delete(transferId);
        await this.save();
        return { success: true };
      }
      if (message.action === "resume") {
        const resumed = await this.resume(transferId);
        return { success: resumed };
      }
      throw new Error("Unsupported browser download command.");
    }

    reconnect() {
      if (!this.reconciliation) {
        this.reconciliation = this.reconcileEntries().finally(() => {
          this.reconciliation = null;
        });
      }
      return this.reconciliation;
    }

    async reconcileEntries() {
      await this.ready;
      // Resolve the ambiguous period where the desktop may have persisted a
      // request just before its transport disconnected.
      for (const entry of [...this.entries.values()]) {
        if (entry.stage === "restore-resume") {
          await this.resume(entry.transferId);
          continue;
        }
        if (!entry.requestStarted || entry.stage === "transferred") continue;
        try {
          const result = await this.request({
            type: "download-status",
            transferId: entry.transferId,
          });
          if (result.action === "queued" && result.retainBrowserCopy) {
            entry.desktopQueued = true;
            entry.stage = "owned";
            await this.save();
          } else if (
            result.action === "queued" ||
            result.action === "completed"
          ) {
            await this.cancel(entry.transferId);
            this.entries.delete(entry.transferId);
            await this.save();
          } else if (result.action === "review") {
            entry.stage = "review";
            await this.save();
          } else if (
            result.action === "missing" ||
            result.action === "browser"
          ) {
            // The desktop did not persist the request, regardless of whether it
            // was awaiting review or an acknowledgement when disconnected.
            await this.resume(entry.transferId);
          }
        } catch {
          // Keep paused until the next reconciliation rather than risking two
          // simultaneous downloads. Initial connection failures resume directly.
        }
      }
    }

    async disconnected() {
      await this.ready;
      // Requests not yet sent can safely return to the browser. Reviews and
      // ambiguous in-flight requests remain paused: the desktop may still be
      // actionable or may have persisted the transfer. Reconnection, dismissal,
      // or clean desktop shutdown resolves them without creating two copies.
      // Do not resume concurrently with pause() or metadata(): that can race
      // with the original handler and create two transfers or strand a pause.
      // The active handler checks this flag before it sends anything.
      for (const entry of this.entries.values())
        if (!entry.requestStarted) entry.connectionLost = true;
      await this.save();
    }
  }

  globalThis.GetANNYDownloadInterceptor = GetANNYDownloadInterceptor;
})();
