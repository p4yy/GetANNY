import VirtualList from "./VirtualList";
import DestinationPreview from "./DestinationPreview";
import React, { useEffect, useMemo, useState } from "react";
import {
  LuArrowDownToLine,
  LuLink,
  LuFolderOpen,
  LuMagnet,
  LuArrowUpRight,
  LuX,
  LuSearch,
  LuFile,
  LuFilm,
  LuMusic2,
  LuCheck,
  LuListChecks,
  LuListPlus,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import {
  Button,
  Dialog,
  Field,
  FolderField,
  ErrorBanner,
  IconButton,
} from "./ui";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { useI18n } from "../i18n/useI18n";
import { classifyLink, intakeLines, openLinkIntake } from "../utils/link-intake.mjs";

const videoFile = /\.(mp4|mkv|mov|avi|webm|m4v|ts)$/i;
const audioFile = /\.(mp3|m4a|flac|wav|aac|ogg|opus)$/i;

function TorrentFileIcon({ name }) {
  if (videoFile.test(name)) return <LuFilm />;
  if (audioFile.test(name)) return <LuMusic2 />;
  return <LuFile />;
}

export default function AddDownloadDialog({ initial = {}, onClose }) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const intercepted = Boolean(initial.browserRequestId);
  const [kind, setKind] = useState(initial.torrent ? "torrent" : "file");
  const [url, setUrl] = useState(initial.url || initial.torrentUrl || "");
  const [filename, setFilename] = useState(initial.filename || "");
  const [folder, setFolder] = useState(settings.defaultDownloadPath || "");
  const [torrentInfo, setTorrentInfo] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(() => new Set());
  const [fileQuery, setFileQuery] = useState("");
  const [fileSort, setFileSort] = useState("name");
  const [autoStart, setAutoStart] = useState(
    settings.autoStartDownloads !== false,
  );
  const [torrentOrder, setTorrentOrder] = useState("rarest"),
    [seedMinutes, setSeedMinutes] = useState(0),
    [torrentPriorities, setTorrentPriorities] = useState({});
  const [prioritizeFirstLast, setPrioritizeFirstLast] = useState(false);
  const [freeSpace, setFreeSpace] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const detected = intercepted ? null : classifyLink(url);
  const submitKind = kind === "torrent" ? "torrent" : detected?.kind || "file";
  // The Downloads list can hand over a completed .torrent immediately. Show
  // the existing inspected file picker; never start a transfer implicitly.
  useEffect(() => {
    if (!initial.autoInspectTorrent || !initial.torrent || !initial.torrentUrl)
      return;
    let disposed = false;
    setBusy(true);
    api.invoke("torrent:inspect", { torrent: initial.torrentUrl })
      .then((info) => {
        if (disposed) return;
        setTorrentInfo(info);
        setSelectedFiles(new Set(info.files.map((file) => file.index)));
        setAutoStart(settings.autoStartDownloads !== false);
      })
      .catch((cause) => {
        if (!disposed) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => { disposed = true; };
  }, [initial.autoInspectTorrent, initial.torrent, initial.torrentUrl, settings.autoStartDownloads]);
  const clearLink = () => {
    setUrl("");
    setError("");
    document.getElementById("download-url")?.focus();
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (intercepted && (kind !== "file" || url.trim() !== initial.url))
        throw new Error(t("add.handoffMismatch"));
      if (submitKind === "media") {
        onClose();
        useUIStore.getState().openMedia(detected.url);
        return;
      }
      if (submitKind === "file" && !(detected || (intercepted && classifyLink(url))))
        throw new Error(t("add.invalidUrl"));
      let info = torrentInfo;
      if (submitKind === "torrent" && !info) {
        setKind("torrent");
        info = await api.invoke("torrent:inspect", { torrent: url.trim() });
        if (info.files.length > 0) {
          setTorrentInfo(info);
          setSelectedFiles(new Set(info.files.map((file) => file.index)));
          setAutoStart(settings.autoStartDownloads !== false);
          return;
        }
      }
      const downloadId = await api.invoke(
        submitKind === "torrent" ? "download:add-torrent" : "download:add",
        submitKind === "torrent"
          ? {
              torrent: url.trim(),
              savePath:
                folder !== settings.defaultDownloadPath ? folder : undefined,
              selectedFiles:
                info && info.files.length > 0 ? [...selectedFiles] : undefined,
              torrentName: info?.name,
              infoHash: info?.infoHash,
              torrentTrackers: info?.trackers,
              torrentFileBase64: info?.torrentFileBase64,
              sourcePage: initial.sourcePage,
              startImmediately: autoStart,
              prioritizeFirstLast,
              torrentOrder,
              seedMinutes,
              torrentPriorities,
            }
          : {
              url: detected?.url || url.trim(),
              filename: filename || undefined,
              headers: initial.headers,
              browserTransferId: initial.browserTransferId,
              browserSource: initial.browserSource,
              ...(folder !== settings.defaultDownloadPath
                ? { savePath: folder }
                : {}),
            },
      );
      // Only clear the completed .torrent metadata entry AFTER the real torrent
      // was accepted. Never delete the small source file from disk: it may
      // be needed again for inspection or recovery.
      if (submitKind === "torrent" && initial.sourceTorrentDownloadId) {
        try {
          await api.invoke("download:remove", {
            id: initial.sourceTorrentDownloadId,
            deleteFile: false,
          });
        } catch (cause) {
          useUIStore.getState().notify(
            "Torrent added. The original .torrent entry could not be cleared from Downloads.",
            "error",
          );
        }
      }
      if (initial.browserRequestId) {
        useUIStore.getState().removeRequest(initial.browserRequestId);
        try {
          const handoff = await api.invoke("browser:commit-request", {
            id: initial.browserRequestId,
            downloadId,
          });
          if (handoff.cancelled === false)
            useUIStore.getState().notify(t("add.handoffUnconfirmed"), "error");
        } catch (error) {
          useUIStore
            .getState()
            .notify(
              t("add.handoffFailed", { error: errorMessage(error) }),
              "error",
            );
        }
      }
      useUIStore
        .getState()
        .notify(
          (submitKind === "torrent" ? autoStart : settings.autoStartDownloads)
            ? t("add.queuedNotice")
            : t("add.pausedNotice"),
        );
      useUIStore
        .getState()
        .setActiveTab(submitKind === "torrent" ? "torrent" : "all");
      onClose(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setFreeSpace(null);
    if (!torrentInfo || !api.desktop) return;
    let cancelled = false;
    api
      .invoke("storage:free-space", folder)
      .then((size) => {
        if (!cancelled) setFreeSpace(size);
      })
      .catch(() => {
        if (!cancelled) setFreeSpace(null);
      });
    return () => {
      cancelled = true;
    };
  }, [torrentInfo, folder]);
  const visibleTorrentFiles = useMemo(() => {
    if (!torrentInfo) return [];
    const query = fileQuery.trim().toLocaleLowerCase();
    return torrentInfo.files
      .filter((file) => !query || file.path.toLocaleLowerCase().includes(query))
      .sort((a, b) =>
        (fileSort === "size" ? b.length - a.length : 0) || a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [torrentInfo, fileQuery, fileSort]);
  const mainMedia = useMemo(() => {
    const files = torrentInfo?.files.filter(({ name }) => videoFile.test(name) || audioFile.test(name)) || [];
    return files.reduce((best, file) => {
      if (!best) return file;
      if (videoFile.test(file.name) !== videoFile.test(best.name))
        return videoFile.test(file.name) ? file : best;
      return file.length > best.length ? file : best;
    }, null);
  }, [torrentInfo]);
  const toggleFile = (index) =>
    setSelectedFiles((current) => {
      const next = new Set(current);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  const selectedBytes =
    torrentInfo?.files.reduce(
      (sum, file) => sum + (selectedFiles.has(file.index) ? file.length : 0),
      0,
    ) || 0;
  const insufficientSpace = !!torrentInfo && freeSpace !== null && selectedBytes > freeSpace;
  const formatSize = (value) => {
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const level = Math.min(
      Math.floor(Math.log(value) / Math.log(1024)),
      units.length - 1,
    );
    return `${(value / 1024 ** level).toFixed(level === 0 ? 0 : 1)} ${units[level]}`;
  };
  return (
    <Dialog
      title={torrentInfo ? t("torrentPicker.title") : t("add.title")}
      description={
        torrentInfo
          ? t("torrentPicker.description")
          : initial.source
            ? t("add.descriptionSource", { source: initial.source })
            : t("add.descriptionDefault")
      }
      onClose={() => !busy && onClose()}
      wide={!!torrentInfo}
      busy={busy}
      fixedActions
    >
      <form onSubmit={submit}>
        <div
          className={`dialog-body ${torrentInfo ? "torrent-picker-body" : ""}`}
        >
          {!torrentInfo && <DestinationPreview
            kind={submitKind}
            url={url}
            filename={filename}
            savePath={
              folder !== settings.defaultDownloadPath ? folder : undefined
            }
          />}
          {!torrentInfo && (
            <>
              <div className="segmented">
                <button
                  type="button"
                  className={kind === "file" ? "selected" : ""}
                  onClick={() => {
                    setKind("file");
                    setTorrentInfo(null);
                    setError("");
                  }}
                >
                  <LuLink />
                  {t("add.fileUrl")}
                </button>
                <button
                  type="button"
                  className={kind === "torrent" ? "selected" : ""}
                  disabled={intercepted}
                  title={intercepted ? t("add.torrentLocked") : undefined}
                  onClick={() => {
                    setKind("torrent");
                    setTorrentInfo(null);
                    setAutoStart(settings.autoStartDownloads !== false);
                    setError("");
                  }}
                >
                  <LuMagnet />
                  {t("add.torrent")}
                </button>
              </div>
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <Field
                label={
                  kind === "file" ? t("add.downloadLink") : t("add.torrentLink")
                }
                id="download-url"
                hint={
                  intercepted
                    ? t("add.handoffLocked")
                    : kind === "file"
                      ? t("add.fileHint")
                      : t("add.torrentHint")
                }
              >
                <div className="input-group">
                  <LuLink />
                  <input
                    data-autofocus
                    id="download-url"
                    required
                    readOnly={intercepted}
                    type={kind === "file" ? "url" : "text"}
                    value={url}
                    onPaste={(event) => {
                      const text = event.clipboardData.getData("text/plain");
                      if (!intercepted && intakeLines(text).length > 1 && openLinkIntake(text, useUIStore.getState())) event.preventDefault();
                    }}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setTorrentInfo(null);
                    }}
                    placeholder={
                      kind === "file"
                        ? "https://example.com/file.zip"
                        : "magnet:?xt=urn:btih:…"
                    }
                    dir="ltr"
                    autoComplete="off"
                    spellCheck="false"
                  />
                  {url && !intercepted && (
                    <IconButton
                      label={t("add.clearLink")}
                      className="clear-link"
                      onClick={clearLink}
                    >
                      <LuX />
                    </IconButton>
                  )}
                  {kind === "torrent" && api.desktop && (
                    <Button
                      variant="ghost"
                      icon={LuFolderOpen}
                      onClick={async () => {
                        try {
                          const file = await api.invoke(
                            "dialog:select-torrent",
                          );
                          if (file) {
                            setUrl(file);
                            setTorrentInfo(null);
                          }
                        } catch (error) {
                          setError(errorMessage(error));
                        }
                      }}
                    >
                      {t("add.chooseFile")}
                    </Button>
                  )}
                </div>
              </Field>
              {kind === "file" && (
                <Field
                  label={t("add.fileName")}
                  id="download-name"
                  hint={t("add.fileNameHint")}
                >
                  <input
                    id="download-name"
                    value={filename}
                    onChange={(event) => setFilename(event.target.value)}
                    placeholder={t("add.automatic")}
                    maxLength={220}
                  />
                </Field>
              )}
              <FolderField value={folder} onChange={setFolder} />
            </>
          )}
          {torrentInfo && (
            <>
              <div className="torrent-picker-summary">
                <div className="torrent-picker-cover" aria-hidden="true">
                  <LuFilm />
                  <span>TORRENT</span>
                </div>
                <div className="torrent-picker-title">
                  <span className="eyebrow">READY TO DOWNLOAD</span>
                  <strong title={torrentInfo.name}>{torrentInfo.name}</strong>
                  <div className="torrent-picker-metadata">
                    <span>{torrentInfo.files.length} files</span>
                    <span>{formatSize(torrentInfo.length)}</span>
                    <span>{torrentInfo.files.some((file) => /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(file.name)) ? "Video included" : "Files and folders"}</span>
                  </div>
                  <small>File preview is available after its data has been downloaded.</small>
                  <span className="torrent-picker-hash" title={torrentInfo.infoHash}>
                    Torrent ID: {String(torrentInfo.infoHash || "").slice(0, 14)}…
                  </span>
                </div>
              </div>
              <div className="torrent-picker-layout">
                <aside className="torrent-picker-settings">
                  <h3>Download preferences</h3>
                  <label>
                    {t("enhance.torrentOrder")}
                    <select
                      value={torrentOrder}
                      onChange={(e) => setTorrentOrder(e.target.value)}
                    >
                      <option value="rarest">{t("enhance.rarest")}</option>
                      <option value="sequential">
                        {t("enhance.sequential")}
                      </option>
                    </select>
                  </label>
                  <label>
                    {t("enhance.seeding")}
                    <select
                      value={seedMinutes}
                      onChange={(e) => setSeedMinutes(Number(e.target.value))}
                    >
                      {[0, 5, 15, 60].map((n) => (
                        <option key={n} value={n}>
                          {n
                            ? t("enhance.seedFor", { minutes: n })
                            : t("enhance.stopAtComplete")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>{t("enhance.seedNote")}</p>
                  <FolderField
                    value={folder}
                    onChange={setFolder}
                    label={t("common.saveTo")}
                    id="torrent-save-folder"
                  />
                  <small className="torrent-free-space">
                    {freeSpace == null
                      ? ""
                      : `${t("torrentPicker.freeSpace")}: ${formatSize(freeSpace)}`}
                  </small>
                  <label className="torrent-option">
                    <input
                      type="checkbox"
                      checked={autoStart}
                      onChange={(event) => setAutoStart(event.target.checked)}
                    />
                    {t("torrentPicker.startAutomatically")}
                  </label>
                  <label className="torrent-option">
                    <input
                      type="checkbox"
                      checked={prioritizeFirstLast}
                      onChange={(event) =>
                        setPrioritizeFirstLast(event.target.checked)
                      }
                    />
                    {t("torrentPicker.firstLastPieces")}
                  </label>
                  <div className="torrent-size-summary">
                    <span>{t("torrentPicker.selectedSize")}</span>
                    <strong>{formatSize(selectedBytes)}</strong>
                  </div>
                  {torrentInfo.comment && (
                    <p className="torrent-comment" title={torrentInfo.comment}>
                      {torrentInfo.comment}
                    </p>
                  )}
                </aside>
                <section
                  className="torrent-file-pane"
                  aria-label={t("torrentPicker.files")}
                >
                  <div className="torrent-file-pane-heading">
                    <div>
                      <h3>Choose your files</h3>
                      <p>Select only the files you want to save.</p>
                    </div>
                    <span>{selectedFiles.size} selected</span>
                  </div>
                  <div className="torrent-file-toolbar">
                    <div className="torrent-file-search">
                      <LuSearch />
                      <input
                        value={fileQuery}
                        onChange={(event) => setFileQuery(event.target.value)}
                        placeholder={t("torrentPicker.filterFiles")}
                        aria-label={t("torrentPicker.filterFiles")}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      icon={LuListChecks}
                      onClick={() =>
                        setSelectedFiles(
                          new Set(torrentInfo.files.map((file) => file.index)),
                        )
                      }
                    >
                      {t("torrentPicker.selectAll")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setSelectedFiles(new Set())}
                    >
                      {t("torrentPicker.selectNone")}
                    </Button>
                    {mainMedia && <Button onClick={() => setSelectedFiles(new Set([mainMedia.index]))}>{t("torrentPicker.mainMediaOnly")}</Button>}
                    <select aria-label={t("torrentPicker.sort")} value={fileSort} onChange={(event) => setFileSort(event.target.value)}>
                      <option value="name">{t("torrentPicker.sortName")}</option>
                      <option value="size">{t("torrentPicker.sortSize")}</option>
                    </select>
                  </div>
                  <div className="torrent-file-heading">
                    <span>{t("torrentPicker.fileName")}</span>
                    <span>{t("torrentPicker.size")}</span>
                  </div>
                  {visibleTorrentFiles.length ? (
                    <VirtualList
                      className="torrent-file-list"
                      items={visibleTorrentFiles}
                      getKey={(file) => file.index}
                      estimate={34}
                      scrollParent=".dialog-body"
                      renderItem={(file) => (
                        <div
                          className={`torrent-file-row ${selectedFiles.has(file.index) ? "selected" : ""}`}
                          key={file.index}
                        >
                          <input
                            type="checkbox"
                            aria-label={file.path}
                            checked={selectedFiles.has(file.index)}
                            onChange={() => toggleFile(file.index)}
                          />
                          <span className="torrent-file-name">
                            <TorrentFileIcon name={file.name} />
                            <span title={file.path}>{file.name}</span>
                          </span>
                          <select
                            className="torrent-file-priority"
                            aria-label={t("enhance.filePriority", {
                              name: file.name,
                            })}
                            value={torrentPriorities[file.index] || 0}
                            onChange={(e) =>
                              setTorrentPriorities((p) => ({
                                ...p,
                                [file.index]: Number(e.target.value),
                              }))
                            }
                          >
                            <option value="0">{t("workflow.normal")}</option>
                            <option value="1">{t("workflow.high")}</option>
                            <option value="2">{t("enhance.first")}</option>
                          </select>
                          <span className="torrent-file-size">
                            {formatSize(file.length)}
                          </span>
                        </div>
                      )}
                    />
                  ) : (
                    <p className="torrent-no-files">
                      {t("torrentPicker.noMatches")}
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          {!torrentInfo && (
            <div className="form-note">
              <LuArrowDownToLine />
              <span>
                {submitKind === "file" ? t("add.connections", {
                  count: settings.maxConnectionsPerDownload || 8,
                }) : t(submitKind === "media" ? "add.mediaLink" : "add.torrentHint")}{" · "}
                {settings.autoStartDownloads
                  ? t("add.autoStart")
                  : t("add.paused")}
                <br />
                {t("add.existingNote")}
              </span>
            </div>
          )}
          {kind === "file" && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                useUIStore.getState().openMedia(url);
                onClose();
              }}
            >
              {t("add.mediaLink")} <LuArrowUpRight />
            </button>
          )}
          {!torrentInfo && !intercepted && <Button icon={LuListPlus} variant="ghost" onClick={() => useUIStore.getState().setAddModal({ batch: true, text: url })}>{t("batch.title")}</Button>}
          {insufficientSpace && <ErrorBanner>{t("torrentPicker.insufficientSpace")}</ErrorBanner>}
        </div>
        <footer className="dialog-footer">
          {torrentInfo && (
            <span className="torrent-picked-count">
              <LuCheck />
              {t("torrentPicker.selectedCount", {
                selected: selectedFiles.size,
                total: torrentInfo.files.length,
              })} · {formatSize(selectedBytes)}
            </span>
          )}
          <Button
            disabled={busy}
            onClick={torrentInfo ? () => setTorrentInfo(null) : onClose}
          >
            {torrentInfo ? t("torrentPicker.back") : t("add.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={torrentInfo ? LuMagnet : LuArrowDownToLine}
            busy={busy}
            disabled={!!torrentInfo && (selectedFiles.size === 0 || insufficientSpace)}
          >
            {torrentInfo
              ? t("torrentPicker.downloadSelected")
              : submitKind === "torrent"
                ? t("torrentPicker.review")
                : submitKind === "media"
                  ? t("media.analyze")
                : settings.autoStartDownloads
                  ? t("add.start")
                  : t("add.add")}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
