import React, { useMemo, useRef, useState } from "react";
import { LuListPlus } from "react-icons/lu";
import { api, errorMessage } from "../api";
import { useI18n } from "../i18n/useI18n";
import useDownloadStore from "../stores/useDownloadStore";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { choosePreferredMediaFormat } from "../utils/choose-media-format.mjs";
import {
  BATCH_LIMIT,
  classifyLink,
  intakeLines,
} from "../utils/link-intake.mjs";
import { Button, Dialog, Field, FolderField, Select } from "./ui";

export default function BatchAddDialog({ initialText, onClose }) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const downloads = useDownloadStore((state) => state.downloads);
  const [text, setText] = useState(initialText || "");
  const [folder, setFolder] = useState(null);
  const [changes, setChanges] = useState({});
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const work = useRef(null);
  const lines = useMemo(() => intakeLines(text), [text]);
  const rows = useMemo(() => {
    const library = new Set(
      downloads.flatMap((item) => {
        if (
          ["failed", "cancelled"].includes(item.status) ||
          item.privateSession
        )
          return [];
        const link = classifyLink(item.url);
        return link ? [`${item.kind}:${link.key}`] : [];
      }),
    );
    const seen = new Set();
    return lines.slice(0, BATCH_LIMIT).map((line, index) => {
      const link = classifyLink(line);
      const row = {
        index,
        line,
        link,
        kind: link?.kind,
        priority: "normal",
        ...changes[index],
      };
      const identity = `${row.kind}:${link?.key}`;
      const duplicate = link && (library.has(identity) || seen.has(identity));
      if (link && row.enabled !== false) seen.add(identity);
      return { ...row, duplicate, enabled: row.enabled ?? true };
    });
  }, [lines, downloads, changes]);
  const ready = rows.filter(
    (row) =>
      row.link && row.enabled && !row.duplicate && !results[row.index]?.ok,
  );
  const change = (index, values) =>
    setChanges((current) => ({
      ...current,
      [index]: { ...current[index], ...values },
    }));

  const queue = async (event) => {
    event.preventDefault();
    if (work.current || !ready.length || lines.length > BATCH_LIMIT) return;
    const task = { stop: false, requestId: null };
    work.current = task;
    setBusy(true);
    for (const row of ready) {
      if (task.stop) break;
      const savePath = (row.folder || folder || "").trim() || undefined;
      const options = { priority: row.priority, savePath };
      let result;
      try {
        if (row.kind === "media") {
          task.requestId = crypto.randomUUID();
          const info = await api.invoke(
            "media:get-formats",
            row.link.url,
            task.requestId,
          );
          task.requestId = null;
          if (task.stop) break;
          const format = choosePreferredMediaFormat(
            info.formats,
            settings.mediaPreferences,
            info.tools,
          );
          if (!format || (format.mergeAudio && !info.tools?.ffmpeg))
            throw new Error(t("media.noFormats"));
          await api.invoke("media:download", {
            ...options,
            analysisId: info.analysisId,
            formatId: format.formatId,
          });
        } else if (row.kind === "torrent") {
          await api.invoke("download:add-torrent", {
            ...options,
            torrent: row.link.url,
          });
        } else {
          await api.invoke("download:add", { ...options, url: row.link.url });
        }
        result = { ok: true };
      } catch (error) {
        if (task.stop && task.requestId) break;
        result = { ok: false, error: errorMessage(error) };
      } finally {
        task.requestId = null;
      }
      setResults((current) => ({ ...current, [row.index]: result }));
    }
    work.current = null;
    setBusy(false);
  };
  const stop = () => {
    const task = work.current;
    if (!task) return;
    task.stop = true;
    if (task.requestId)
      api.invoke("media:cancel-analysis", task.requestId).catch(() => {});
  };

  return (
    <Dialog
      title={t("batch.title")}
      description={t("batch.description")}
      onClose={onClose}
      wide
      busy={busy}
      fixedActions
    >
      <form onSubmit={queue}>
        <div className="dialog-body batch-body">
          <Field label={t("batch.links")} id="batch-links">
            <textarea
              id="batch-links"
              data-autofocus
              dir="ltr"
              rows={4}
              maxLength={BATCH_LIMIT * 8193}
              spellCheck={false}
              disabled={busy}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setChanges({});
                setResults({});
              }}
            />
          </Field>
          <div className="batch-destination" aria-disabled={busy}>
            <fieldset disabled={busy}>
              <FolderField
                id="batch-folder"
                label={t("batch.folder")}
                value={folder ?? settings.defaultDownloadPath ?? ""}
                onChange={setFolder}
                desktop={api.desktop}
              />
              {folder !== null && (
                <Button variant="ghost" onClick={() => setFolder(null)}>
                  {t("batch.useRules")}
                </Button>
              )}
            </fieldset>
            {!folder && <p>{t("batch.destinationRules")}</p>}
          </div>
          {lines.length > BATCH_LIMIT && (
            <p className="error-banner" role="alert">
              {t("batch.limit", { count: BATCH_LIMIT })}
            </p>
          )}
          <div className="batch-rows">
            {rows.map((row) => {
              const result = results[row.index];
              return (
                <fieldset
                  className="batch-row"
                  key={row.index}
                  disabled={busy || result?.ok}
                >
                  <div className="batch-row-link">
                    <input
                      type="checkbox"
                      checked={!!row.link && row.enabled && !row.duplicate}
                      disabled={!row.link || row.duplicate}
                      aria-label={t("batch.include", { count: row.index + 1 })}
                      onChange={(event) =>
                        change(row.index, { enabled: event.target.checked })
                      }
                    />
                    <bdi title={row.line}>{row.line}</bdi>
                  </div>
                  {row.link && (
                    <div className="batch-row-controls">
                      <Select
                        aria-label={t("details.type")}
                        value={row.kind}
                        onChange={(event) =>
                          change(row.index, { kind: event.target.value })
                        }
                      >
                        {row.link.kinds.map((kind) => (
                          <option key={kind} value={kind}>
                            {t(
                              `details.kind${kind[0].toUpperCase()}${kind.slice(1)}`,
                            )}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label={t("workflow.priority")}
                        value={row.priority}
                        onChange={(event) =>
                          change(row.index, { priority: event.target.value })
                        }
                      >
                        {["low", "normal", "high"].map((priority) => (
                          <option key={priority} value={priority}>
                            {t(`workflow.${priority}`)}
                          </option>
                        ))}
                      </Select>
                      <input
                        dir="ltr"
                        aria-label={t("common.saveTo")}
                        value={row.folder || ""}
                        placeholder={folder || t("batch.useRules")}
                        onChange={(event) =>
                          change(row.index, { folder: event.target.value })
                        }
                        spellCheck={false}
                      />
                    </div>
                  )}
                  <small role="status">
                    {result?.ok
                      ? t("batch.added")
                      : result?.error ||
                        (!row.link
                          ? t("batch.invalid")
                          : row.duplicate
                            ? t("batch.duplicate")
                            : row.kind === "torrent"
                              ? t("batch.torrentAllFiles")
                              : "")}
                  </small>
                </fieldset>
              );
            })}
          </div>
        </div>
        <footer className="dialog-footer">
          {busy ? (
            <Button onClick={stop}>{t("batch.stop")}</Button>
          ) : (
            <Button onClick={onClose}>{t("details.done")}</Button>
          )}
          <Button
            type="submit"
            icon={LuListPlus}
            variant="primary"
            busy={busy}
            disabled={!ready.length || lines.length > BATCH_LIMIT}
          >
            {t("batch.queue", { count: ready.length })}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
