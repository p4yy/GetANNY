import { useEffect } from "react";
import { api } from "../api";
import useDownloadStore from "../stores/useDownloadStore";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { translate } from "../i18n";
export function useIPC() {
  useEffect(() => {
    const cleanups = [
      api.on("downloads:changed", (downloads) =>
        useDownloadStore.getState().setDownloads(downloads),
      ),
      api.on("download:progress", ({ id, ...data }) =>
        useDownloadStore.getState().update(id, data),
      ),
      api.on("download:complete", (data) => {
        if (
          !["all", "active", "completed"].includes(
            useUIStore.getState().activeTab,
          )
        )
          useUIStore
            .getState()
            .notify(
              translate(
                useSettingsStore.getState().settings.language,
                "workflow.downloaded",
                { name: data.filename },
              ),
            );
      }),
      api.on("download:error", (data) => {
        const requiresAuthentication =
          data.code === "AUTH_REQUIRED" ||
          /^Authentication required:/.test(data.error || "");
        if (
          requiresAuthentication ||
          !["all", "active", "failed"].includes(useUIStore.getState().activeTab)
        )
          useUIStore.getState().notify(data.error, "error");
      }),
      api.on("media:social-batch-progress", ({ queued, skipped, total }) => {
        if (queued + skipped !== total) return;
        const language = useSettingsStore.getState().settings.language;
        useUIStore
          .getState()
          .notify(
            translate(language, "media.socialBatchResult", { queued, skipped }),
            queued ? undefined : "error",
          );
      }),
      api.on("settings:changed", (settings) =>
        useSettingsStore.getState().setSettings(settings),
      ),
      api.on("browser:handoff", (request) => {
        if (request.id) useUIStore.getState().highlightDownload(request.id);
        document.documentElement.dataset.uiIdle = "false";
        if (request.kind !== "media") useUIStore.getState().setActiveTab("all");
        api
          .invoke("download:get-all")
          .then((rows) => useDownloadStore.getState().setDownloads(rows))
          .catch(() => {});
      }),
      api.on("browser:request", (request) =>
        useUIStore.getState().addRequest(request),
      ),
      api.on("menu:add-download", () => useUIStore.getState().setAddModal({})),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
}
