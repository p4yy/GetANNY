import useSettingsStore from "../stores/useSettingsStore";
import { binding, shortcutAction } from "../utils/shortcuts.mjs";
import React, { useRef, useState, useEffect } from "react";
import { Button } from "./ui";
import {
  LuChevronLeft,
  LuChevronRight,
  LuChevronsLeft,
  LuChevronsRight,
  LuSkipBack,
  LuKeyboard,
} from "react-icons/lu";
import { useI18n } from "../i18n/useI18n";
import { formatTime } from "./VideoSegmentSelector";

export default function VideoPreview({ result, format, segment, onChange }) {
  const { t } = useI18n();
  const shortcuts = useSettingsStore((state) => state.settings.shortcuts);
  const video = useRef(null);
  const [time, setTime] = useState(0),
    [failed, setFailed] = useState(false);
  const source =
    format?.previewUrl || result.formats.find((f) => f.previewUrl)?.previewUrl;
  const fps = format?.fps || 30;
  const minimum = 1 / fps;
  const total = result.duration;
  useEffect(() => {
    setFailed(false);
    setTime(0);
  }, [source]);
  const step = (delta) => {
    const el = video.current;
    if (!el) return;
    el.pause();
    el.currentTime = Math.max(0, Math.min(total, el.currentTime + delta / fps));
  };
  const mark = (which) => {
    const next = { start: segment?.start || 0, end: segment?.end || total };
    const current = video.current?.currentTime || 0;
    if (which === "start") next.start = Math.min(current, next.end - minimum);
    else next.end = Math.max(current, next.start + minimum);
    onChange(next);
  };
  return (
    <section
      className="video-preview"
      tabIndex="0"
      aria-label={t("trim.preview")}
      onKeyDown={(e) => {
        if (!video.current || failed) return;
        if (e.target.closest("input,select,button")) return;
        const action = shortcutAction(e, shortcuts, "preview");
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        if (action === "back") step(-1);
        else if (action === "forward") step(1);
        else if (action === "start" || action === "end") mark(action);
        else if (action === "play") {
          video.current.paused
            ? video.current.play().catch(() => setFailed(true))
            : video.current.pause();
        }
      }}
    >
      {source && !failed ? (
        <video
          key={source}
          ref={video}
          src={source}
          poster={result.thumbnail || undefined}
          controls
          preload="metadata"
          playsInline
          onError={() => setFailed(true)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        />
      ) : (
        <div className="preview-unavailable">
          <p>{t("trim.previewUnavailable")}</p>
        </div>
      )}
      {source && !failed && (
        <div className="preview-controls">
          <div
            className="preview-frame-group"
            role="group"
            aria-label={t("trim.frameNavigation")}
            dir="ltr"
          >
            <Button
              className="preview-step"
              variant="ghost"
              icon={LuChevronLeft}
              aria-label={t("trim.previousFrame")}
              title={t("trim.previousFrame")}
              onClick={() => step(-1)}
            />
            <bdi className="preview-timecode" aria-live="off">
              {formatTime(time, true)}
            </bdi>
            <Button
              className="preview-step"
              variant="ghost"
              icon={LuChevronRight}
              aria-label={t("trim.nextFrame")}
              title={t("trim.nextFrame")}
              onClick={() => step(1)}
            />
          </div>
          <div
            className="preview-mark-group"
            role="group"
            aria-label={t("media.segment.title")}
          >
            <Button
              icon={LuChevronsLeft}

              onClick={() => mark("start")}
            >
              {t("trim.markStart")}
              <kbd>{binding(shortcuts, "preview", "start")}</kbd>
            </Button>
            <Button
              icon={LuChevronsRight}

              onClick={() => mark("end")}
            >
              {t("trim.markEnd")}
              <kbd>{binding(shortcuts, "preview", "end")}</kbd>
            </Button>
          </div>
          <Button
            className="preview-seek"
            variant="ghost"
            icon={LuSkipBack}
            onClick={() => {
              if (video.current)
                video.current.currentTime = segment?.start || 0;
            }}
          >
            {t("trim.seekStart")}
          </Button>
        </div>
      )}
      {source && !failed && (
        <details className="preview-shortcuts">
          <summary>
            <LuKeyboard aria-hidden="true" />
            {t("trim.shortcutsTitle")}
          </summary>
          <p>
            {["back", "forward", "play"]
              .map((action) => binding(shortcuts, "preview", action))
              .join(" · ")}
          </p>
        </details>
      )}
    </section>
  );
}
