import React, { useState } from "react";
import { api, errorMessage } from "../api";
import { Button, Select, ErrorBanner } from "./ui";
import useDownloadStore from "../stores/useDownloadStore";
import { useI18n } from "../i18n/useI18n";

export default function DownloadWorkflowControls({ item }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(
    String(Math.round((item.downloadSpeedLimit || 0) / 1024)),
  );
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const repairable = ["paused", "failed", "cancelled"].includes(item.status);
  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const move = (delta) =>
    run(async () => {
      const queue = useDownloadStore
        .getState()
        .downloads.filter(
          (value) =>
            value.status === "queued" &&
            (value.priority || 0) === (item.priority || 0),
        )
        .sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0))
        .map((value) => value.id);
      const index = queue.indexOf(item.id),
        target = index + delta;
      if (index < 0 || target < 0 || target >= queue.length) return;
      [queue[index], queue[target]] = [queue[target], queue[index]];
      await api.invoke("download:reorder", queue);
    });
  return (
    <section className="workflow-controls">
      <h3>{t("workflow.controls")}</h3>
      {item.stage === "seeding" && (
        <>
          <p>{t("enhance.sharing", { seconds: item.seedRemaining || 0 })}</p>
          <Button
            busy={busy}
            onClick={() =>
              run(() => api.invoke("torrent:finish-seeding", item.id))
            }
          >
            {t("enhance.stopSharing")}
          </Button>
        </>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && <p role="status">{notice}</p>}
      <label>
        {t("workflow.priority")}
        <Select
          value={item.priority || 0}
          disabled={busy}
          onChange={(e) =>
            run(() =>
              api.invoke("download:configure", {
                id: item.id,
                changes: { priority: Number(e.target.value) },
              }),
            )
          }
        >
          <option value="1">{t("workflow.high")}</option>
          <option value="0">{t("workflow.normal")}</option>
          <option value="-1">{t("workflow.low")}</option>
        </Select>
      </label>
      <label>
        {t("workflow.limit")}
        <input
          dir="ltr"
          type="number"
          min="0"
          max="1073741824"
          step="1"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </label>
      <p>{t("workflow.limitNote")}</p>
      <Button
        busy={busy}
        disabled={
          !Number.isSafeInteger(Number(limit)) ||
          Number(limit) < 0 ||
          limit === "" ||
          (item.kind !== "file" && !repairable && item.status !== "queued")
        }
        onClick={() =>
          run(() =>
            api.invoke("download:configure", {
              id: item.id,
              changes: { downloadSpeedLimit: Number(limit) * 1024 },
            }),
          )
        }
      >
        {t("workflow.apply")}
      </Button>
      {item.status === "queued" && (
        <div className="workflow-actions">
          <Button disabled={busy} onClick={() => move(-1)}>
            {t("workflow.moveUp")}
          </Button>
          <Button disabled={busy} onClick={() => move(1)}>
            {t("workflow.moveDown")}
          </Button>
        </div>
      )}
      {repairable && (
        <>
          <h3>{t("workflow.recovery")}</h3>
          {item.kind === "file" && (
            <Button
              busy={busy}
              onClick={() =>
                run(async () => {
                  await api.invoke("download:browser-fallback", item.id);
                  setNotice(t("workflow.browserManaged"));
                })
              }
            >
              {t("workflow.browserFallback")}
            </Button>
          )}
          <p>
            {t(
              item.sessionRequired
                ? "workflow.sessionNote"
                : "workflow.resumeNote",
            )}
          </p>
          {item.kind !== "torrent" && (
            <label>
              {t("workflow.newLink")}
              <input
                type="url"
                dir="ltr"
                value={url}
                placeholder="https://"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
          )}
          <div className="workflow-actions">
            {item.kind === "file" && (
              <Button
                busy={busy}
                disabled={!/^https?:\/\//i.test(url)}
                onClick={() =>
                  run(async () => {
                    await api.invoke("download:recover", { id: item.id, url });
                    setUrl("");
                  })
                }
              >
                {t("workflow.refreshLink")}
              </Button>
            )}
            {item.kind === "media" && (
              <Button
                onClick={() => {
                  import("../stores/useUIStore").then(({ default: store }) => {
                    store.getState().setDetails(null);
                    store.getState().openMedia(url || item.url);
                    store.getState().setActiveTab("media");
                  });
                }}
              >
                {t("workflow.reanalyze")}
              </Button>
            )}
            <Button
              busy={busy}
              onClick={() =>
                run(async () => {
                  const folder = await api.invoke("dialog:select-folder");
                  if (folder)
                    await api.invoke("download:recover", {
                      id: item.id,
                      savePath: folder,
                    });
                })
              }
            >
              {t("workflow.relocate")}
            </Button>
            <Button
              busy={busy}
              disabled={!!item.sessionRequired}
              onClick={() => run(() => api.invoke("download:resume", item.id))}
            >
              {t("workflow.resume")}
            </Button>
          </div>
          <small>{t("workflow.replaceNote")}</small>
        </>
      )}
    </section>
  );
}
