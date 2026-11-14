import { useEffect, useRef, useState } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { duration } from "../utils/format";
import { useI18n } from "../i18n/useI18n";
import useSettingsStore from "../stores/useSettingsStore";
import { shortcutAction } from "../utils/shortcuts.mjs";

function formatTime(value, showHours = false) {
  const millis = Math.max(0, Math.round(value * 1000));
  const whole = Math.floor(millis / 1000);
  const fraction =
    millis % 1000
      ? "." +
        String(millis % 1000)
          .padStart(3, "0")
          .replace(/0+$/, "")
      : "";
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  if (showHours || hours)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${fraction}`;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${fraction}`;
}

function parseTime(raw) {
  const parts = String(raw).trim().split(":");
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some(
      (part, index) =>
        !(index === parts.length - 1 ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/).test(
          part,
        ),
    )
  )
    return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part >= 60)) return null;
  return numbers.length === 2
    ? numbers[0] * 60 + numbers[1]
    : numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

function normalize(value, total, minimum) {
  if (!value) return { start: 0, end: total };
  return {
    start: Math.max(0, Math.min(total - minimum, value.start)),
    end: Math.max(minimum, Math.min(total, value.end)),
  };
}

export default function VideoSegmentSelector({
  duration: totalDuration,
  value,
  onChange,
  fps = 30,
}) {
  const { t } = useI18n();
  const total = totalDuration;
  const [zoom, setZoom] = useState(1);
  const minimum = 1 / Math.max(1, fps);
  const range = normalize(value, total, minimum);
  const track = useRef(null);
  const drag = useRef(null);
  const pending = useRef(null);
  const frame = useRef(0);
  const startInput = useRef(null);
  const endInput = useRef(null);
  const [drafts, setDrafts] = useState({
    start: formatTime(range.start, total >= 3600),
    end: formatTime(range.end, total >= 3600),
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (document.activeElement !== startInput.current)
      setDrafts((old) => ({
        ...old,
        start: formatTime(range.start, total >= 3600),
      }));
    if (document.activeElement !== endInput.current)
      setDrafts((old) => ({
        ...old,
        end: formatTime(range.end, total >= 3600),
      }));
  }, [range.start, range.end, total]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const emitRange = (next) => {
    const normalized = {
      start: Math.round(next.start * 1000) / 1000,
      end: Math.round(next.end * 1000) / 1000,
    };
    if (normalized.start <= 0 && normalized.end >= total) onChange(null);
    else onChange(normalized);
  };

  const beginDrag = (handle, event) => {
    event.preventDefault();
    const rect = track.current?.getBoundingClientRect();
    if (!rect?.width) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      handle,
      pointer: event.pointerId,
      x: event.clientX,
      value: range[handle],
      width: rect.width,
      fine: event.shiftKey,
      range,
    };
  };

  const moveDrag = (event) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const scale = current.fine || event.shiftKey ? 0.1 : 1;
    const delta = ((event.clientX - current.x) / current.width) * total * scale;
    const minimum = 1 / Math.max(1, fps);
    const next = { ...current.range };
    if (current.handle === "start")
      next.start = Math.max(
        0,
        Math.min(next.end - minimum, current.value + delta),
      );
    else
      next.end = Math.min(
        total,
        Math.max(next.start + minimum, current.value + delta),
      );
    pending.current = next;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (pending.current) emitRange(pending.current);
    });
  };

  const endDrag = (event) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    drag.current = null;
    if (pending.current) emitRange(pending.current);
    pending.current = null;
  };

  const keyboardMove = (handle, event) => {
    const bindings = useSettingsStore.getState().settings.shortcuts;
    const action = shortcutAction(event, bindings, "timeline");
    if (!action) return;
    const frame = 1 / Math.max(1, fps);
    const steps = {
      earlier: -frame,
      earlierAlternate: -frame,
      later: frame,
      laterAlternate: frame,
      earlierTen: -10,
      earlierTenAlternate: -10,
      laterTen: 10,
      laterTenAlternate: 10,
      earlierThirty: -30,
      laterThirty: 30,
      timelineStart: -total,
      timelineEnd: total,
    };
    const delta = steps[action];
    event.preventDefault();
    const next = { ...range };
    if (handle === "start")
      next.start = Math.max(
        0,
        Math.min(next.end - minimum, range.start + delta),
      );
    else
      next.end = Math.min(
        total,
        Math.max(next.start + minimum, range.end + delta),
      );
    emitRange(next);
  };

  const commitInput = (which) => {
    const parsed = parseTime(drafts[which]);
    const other = which === "start" ? range.end : range.start;
    let message = "";
    if (parsed == null) message = t("media.segment.invalidTime");
    else if (parsed > total) message = t("media.segment.outOfRange");
    else if (
      which === "start" ? parsed > other - minimum : parsed < other + minimum
    )
      message = t("media.segment.rangeError");
    setErrors((old) => ({ ...old, [which]: message }));
    if (message) return;
    const next = { ...range, [which]: parsed };
    emitRange(next);
    setDrafts((old) => ({
      ...old,
      [which]: formatTime(parsed, total >= 3600),
    }));
  };

  const left = (range.start / total) * 100;
  const width = ((range.end - range.start) / total) * 100;
  return (
    <section className="media-segment" aria-label={t("media.segment.title")}>
      <div className="media-segment-heading">
        <div>
          <strong>{t("media.segment.title")}</strong>
          <small>{t("media.segment.description")}</small>
        </div>
        <button
          type="button"
          className="segment-reset"
          onClick={() => {
            onChange(null);
            setErrors({});
          }}
        >
          <LuRotateCcw /> {t("media.segment.fullVideo")}
        </button>
      </div>
      <label className="timeline-zoom">
        {t("trim.zoom")}
        <input
          type="range"
          min="1"
          max="8"
          step="1"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <bdi>{zoom}×</bdi>
      </label>
      <div className="segment-scroll" dir="ltr">
        <div className="segment-track-wrap" style={{ width: `${zoom * 100}%` }}>
          <div className="segment-track" ref={track}>
            <div
              className="segment-selected"
              style={{ left: `${left}%`, width: `${width}%` }}
            />
            {["start", "end"].map((handle) => (
              <button
                type="button"
                key={handle}
                className={`segment-handle ${handle}`}
                style={{ left: `${(range[handle] / total) * 100}%` }}
                role="slider"
                aria-label={t(`media.segment.${handle}`)}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={range[handle]}
                aria-valuetext={formatTime(range[handle], total >= 3600)}
                onPointerDown={(event) => beginDrag(handle, event)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(event) => keyboardMove(handle, event)}
              />
            ))}
          </div>
          <div className="segment-timeline-labels">
            <span>00:00</span>
            <span>{duration(total)}</span>
          </div>
        </div>
      </div>
      <div className="segment-fields">
        {["start", "end"].map((which) => {
          const input = which === "start" ? startInput : endInput;
          return (
            <label key={which}>
              <span>{t(`media.segment.${which}`)}</span>
              <input
                ref={input}
                value={drafts[which]}
                aria-invalid={!!errors[which]}
                aria-describedby={
                  errors[which] ? `segment-${which}-error` : undefined
                }
                dir="ltr"
                inputMode="decimal"
                onChange={(event) =>
                  setDrafts((old) => ({ ...old, [which]: event.target.value }))
                }
                onBlur={() => commitInput(which)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
              {errors[which] && (
                <small id={`segment-${which}-error`} className="segment-error">
                  {errors[which]}
                </small>
              )}
            </label>
          );
        })}
        <div className="segment-length">
          <span>{t("media.segment.selectedLength")}</span>
          <strong>{formatTime(range.end - range.start, total >= 3600)}</strong>
        </div>
      </div>
      <small className="segment-precision-note">
        {t("media.segment.precision")}
      </small>
    </section>
  );
}

export { formatTime, parseTime };
