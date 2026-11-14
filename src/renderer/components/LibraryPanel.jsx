import React, { useEffect, useState } from "react";
import {
  LuShieldCheck,
  LuPlay,
  LuFolderOpen,
  LuCopy,
  LuArrowUpRight,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import { Button, ErrorBanner } from "./ui";
import { useI18n } from "../i18n/useI18n";
export default function LibraryPanel({ item }) {
  const { t } = useI18n();
  const [expected, setExpected] = useState(""),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(null);
  useEffect(() => {
    setResult(null);
    setExpected("");
    setPreview(null);
    setError("");
  }, [item.id]);
  useEffect(
    () => () => {
      api.invoke("download:verify-cancel", item.id).catch(() => {});
    },
    [item.id],
  );
  const run = async (action) => {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section className="library-panel">
      <h3>{t("enhance.fileTools")}</h3>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="workflow-actions">
        {["Images", "Video", "Audio"].includes(item.category) && (
          <Button
            icon={LuPlay}
            onClick={() =>
              run(async () => {
                const p = await api.invoke("download:local-preview", item.id);
                if (!p) throw new Error(t("enhance.previewUnavailable"));
                setPreview(p);
              })
            }
          >
            {t("enhance.preview")}
          </Button>
        )}
        <Button
          icon={LuArrowUpRight}
          onClick={() => run(() => api.invoke("download:open-file", item.id))}
        >
          {t("enhance.open")}
        </Button>
        <Button
          icon={LuFolderOpen}
          onClick={() => run(() => api.invoke("download:open-folder", item.id))}
        >
          {t("enhance.folder")}
        </Button>
        <Button
          icon={LuCopy}
          onClick={() =>
            run(() => navigator.clipboard.writeText(item.filePath))
          }
        >
          {t("enhance.copyPath")}
        </Button>
      </div>
      {preview && (
        <div className="local-preview">
          {preview.type === "image" ? (
            <img src={preview.url} alt={item.filename} />
          ) : preview.type === "video" ? (
            <video
              src={preview.url}
              controls
              preload="metadata"
              onError={() => setError(t("enhance.previewUnavailable"))}
            />
          ) : (
            <audio
              src={preview.url}
              controls
              preload="metadata"
              onError={() => setError(t("enhance.previewUnavailable"))}
            />
          )}
          <Button onClick={() => setPreview(null)}>
            {t("enhance.closePreview")}
          </Button>
        </div>
      )}
      {item.kind !== "torrent" && (
        <>
          <h3>
            <LuShieldCheck /> {t("enhance.verify")}
          </h3>
          <p>{t("enhance.verifyNote")}</p>
          <label>
            {t("enhance.expected")}
            <input
              dir="ltr"
              value={expected}
              maxLength={64}
              onChange={(e) => {
                setExpected(e.target.value.trim());
                setResult(null);
              }}
              placeholder="SHA-256"
              disabled={busy}
            />
          </label>
          <div className="workflow-actions">
            <Button
              disabled={busy || !/^[a-f0-9]{64}$/i.test(expected)}
              onClick={() =>
                run(async () => {
                  setBusy(true);
                  setResult(null);
                  try {
                    setResult(
                      await api.invoke("download:verify", {
                        id: item.id,
                        expected,
                      }),
                    );
                  } finally {
                    setBusy(false);
                  }
                })
              }
            >
              {t(busy ? "enhance.verifying" : "enhance.verify")}
            </Button>
            {busy && (
              <Button
                onClick={() =>
                  api.invoke("download:verify-cancel", item.id).catch(() => {})
                }
              >
                {t("enhance.cancel")}
              </Button>
            )}
          </div>
          {result && (
            <p
              role="status"
              className={result.matches ? "integrity-pass" : "error-banner"}
            >
              {t(result.matches ? "enhance.match" : "enhance.mismatch")}
              <code dir="ltr">{result.actual}</code>
            </p>
          )}
        </>
      )}
    </section>
  );
}
