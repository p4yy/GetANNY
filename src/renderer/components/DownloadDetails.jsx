import React from "react";
import DownloadWorkflowControls from "./DownloadWorkflowControls";
import LibraryPanel from "./LibraryPanel";
import DownloadHealth from "./DownloadHealth";
import { Button, Dialog } from "./ui";
import { api, errorMessage } from "../api";
import useUIStore from "../stores/useUIStore";
import { bytes, duration } from "../utils/format";
import { useI18n } from "../i18n/useI18n";

export default function DownloadDetails({ item, onClose }) {
  const { t } = useI18n();
  const originalPage =
    !item.privateSession &&
    (item.sourcePage ||
      item.browserPage ||
      (item.kind === "media" ? item.url : undefined));
  const canOpenOriginalPage =
    typeof originalPage === "string" && /^https?:\/\//i.test(originalPage);
  const kindKey =
    item.kind === "torrent"
      ? "details.kindTorrent"
      : item.kind === "media"
        ? "details.kindMedia"
        : "details.kindFile";
  const suffix = (value) =>
    /\.([a-z0-9]{1,12})$/i.exec(value || "")?.[1]?.toUpperCase();
  const requestedFormat =
    item.kind === "media" &&
    (item.media?.requestedContainer === undefined
      ? item.media?.ext
      : item.media.requestedContainer
    )?.toUpperCase();
  const sourceFormat = item.kind === "media" && item.media?.ext?.toUpperCase();
  const savedFormat =
    item.filePath &&
    (item.kind !== "torrent" || item.selectedFiles?.length === 1)
      ? suffix(item.filePath)
      : null;
  const torrentSaved =
    item.kind === "torrent" && item.stage === "seeding" && !!item.filePath;
  const fields = [
    ["details.status", t(`status.${item.status}`)],
    ["details.type", t(kindKey)],
    [
      sourceFormat && !savedFormat && !requestedFormat
        ? "details.sourceFormat"
        : "details.format",
      item.kind === "torrent"
        ? savedFormat || t("details.kindTorrent")
        : item.kind === "media"
          ? savedFormat || requestedFormat || sourceFormat || t("common.unknown")
          : savedFormat ||
            suffix(item.filename) ||
            item.mimeType ||
            t("common.unknown"),
    ],
    ...(savedFormat && requestedFormat && savedFormat !== requestedFormat
      ? [["details.requestedFormat", requestedFormat]]
      : []),
    [
      "details.completed",
      item.completedAt
        ? new Date(item.completedAt).toLocaleString()
        : t("details.notCompleted"),
    ],
    [
      "details.fileSize",
      item.totalSize > 0 || item.status === "completed"
        ? `${item.approximateSize ? `${t("details.approximately")} ` : ""}${bytes(item.totalSize)}`
        : t("details.notProvidedServer"),
    ],
    ["details.transferred", bytes(item.downloadedSize)],
    ["details.speed", item.speed > 0 ? `${bytes(item.speed)}/s` : "—"],
    ["details.remaining", duration(item.eta)],
    [
      "details.resumable",
      item.kind === "file"
        ? item.resumable === undefined
          ? t("details.notChecked")
          : item.resumable
            ? t("details.serverRanges")
            : t("details.noRanges")
        : item.kind === "media"
          ? t("details.ytdlpContinuation")
          : t("details.torrentPieces"),
    ],
    ["details.connections", item.connections || "—"],
    ["details.created", new Date(item.createdAt).toLocaleString()],
    ["details.location", item.filePath || item.savePath],
    ["details.source", item.url],
    ...(canOpenOriginalPage && originalPage !== item.url
      ? [["details.originalPage", originalPage]]
      : []),
  ];
  return (
    <Dialog
      title={t("details.title")}
      description={item.filename}
      onClose={onClose}
      fixedActions
    >
      <div className="dialog-body">
        {!["completed", "cancelled"].includes(item.status) && (
          <DownloadHealth item={item} />
        )}
        <dl className="details-list">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
        {item.kind === "torrent" && (
          <details className="torrent-diagnostics">
            <summary>{t("workflow.technical")}</summary>
            <dl className="details-list">
              {[
                ["downloads.peers", item.peers || 0],
                ["downloads.seeds", item.seeds || 0],
              ].map(([key, count]) => (
                <div key={key}>
                  <dt>{t(key, { count })}</dt>
                  <dd dir="ltr">{count}</dd>
                </div>
              ))}
              <div>
                <dt>{t("workflow.transport")}</dt>
                <dd dir="ltr">{item.torrentTransport || "TCP"}</dd>
              </div>
              <div>
                <dt>{t("workflow.trackers")}</dt>
                <dd>
                  {item.trackerWarning
                    ? t("downloads.trackerWarning")
                    : item.trackerEmptyWarning
                      ? t("downloads.trackerEmptyWarning")
                      : item.peerConnectionWarning
                        ? t("downloads.peerConnectionWarning")
                        : t("workflow.discovering")}
                </dd>
              </div>
            </dl>
          </details>
        )}
        {item.status !== "completed" && (
          <DownloadWorkflowControls item={item} />
        )}
        {(item.status === "completed" || torrentSaved) && (
          <LibraryPanel item={item} />
        )}
        {item.warning && <p role="status">{item.warning}</p>}
        {item.error && <div className="error-banner">{item.error}</div>}
      </div>
      <footer className="dialog-footer">
        {item.kind === "torrent" && item.status !== "completed" && (
          <Button
            onClick={() =>
              api
                .invoke("download:open-working-folder", item.id)
                .catch((error) =>
                  useUIStore.getState().notify(errorMessage(error), "error"),
                )
            }
          >
            Show transfer data
          </Button>
        )}
        {canOpenOriginalPage && (
          <Button
            onClick={() =>
              api
                .invoke("download:open-origin", item.id)
                .catch((error) =>
                  useUIStore.getState().notify(errorMessage(error), "error"),
                )
            }
          >
            {t("details.openOriginalPage")}
          </Button>
        )}
        <Button onClick={onClose}>{t("details.done")}</Button>
      </footer>
    </Dialog>
  );
}
