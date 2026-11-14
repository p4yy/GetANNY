import React from "react";
import { Select } from "./ui";
import { bytes } from "../utils/format";
import { useI18n } from "../i18n/useI18n";
export default function ExportOptions({
  value,
  onChange,
  format,
  result,
  segment,
  audioFormatId,
  onAudioChange,
}) {
  const { t } = useI18n();
  const set = (key, next) => onChange({ ...value, [key]: next });
  const length = segment.end - segment.start;
  const estimate =
    format?.filesize && result.duration
      ? (format.filesize * length) / result.duration
      : format?.bitrate
        ? ((format.bitrate * 1000) / 8) * length
        : null;
  const selectedAudio = result.formats.find(
    (item) => item.formatId === audioFormatId,
  );
  const seekable =
    String(result.extractor).toLowerCase() === "youtube" &&
    /^https?$/.test(format?.protocol || "") &&
    (!selectedAudio || /^https?$/.test(selectedAudio.protocol || ""));
  const timeSaving = Math.round(100 * (1 - length / result.duration));
  return (
    <section className="export-options">
      <h3>{t("trim.export")}</h3>
      <label>
        {t("trim.mode")}
        <Select
          value={value.mode}
          onChange={(e) => set("mode", e.target.value)}
        >
          <option value="precise">{t("trim.precise")}</option>
          <option value="fast">{t("trim.fast")}</option>
        </Select>
      </label>
      <p>{t(value.mode === "fast" ? "trim.fastNote" : "trim.preciseNote")}</p>
      <label>
        {t("trim.container")}
        <Select
          value={value.container}
          onChange={(e) => set("container", e.target.value)}
        >
          <option value="mkv">MKV</option>
          <option value="mp4">MP4</option>
        </Select>
      </label>
      <label>
        {t("trim.quality")}
        <Select
          value={value.quality}
          disabled={value.mode === "fast"}
          onChange={(e) => set("quality", e.target.value)}
        >
          {["high", "balanced", "small"].map((q) => (
            <option key={q} value={q}>
              {t(`trim.${q}`)}
            </option>
          ))}
        </Select>
      </label>
      {format?.mergeAudio && (
        <label>
          {t("trim.audioTrack")}
          <Select
            value={audioFormatId}
            onChange={(e) => onAudioChange(e.target.value)}
          >
            <option value="">{t("trim.autoAudio")}</option>
            {result.formats
              .filter((f) => f.group === "audio")
              .map((f) => (
                <option key={f.formatId} value={f.formatId}>
                  {[
                    f.language,
                    f.quality,
                    f.audioChannels && `${f.audioChannels} ch`,
                    f.ext,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
          </Select>
        </label>
      )}
      <label>
        {t("trim.audio")}
        <Select
          value={value.audio}
          onChange={(e) => set("audio", e.target.value)}
        >
          <option value="all">{t("trim.keepAudio")}</option>
          <option value="none">{t("trim.noAudio")}</option>
        </Select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.subtitles}
          onChange={(e) => set("subtitles", e.target.checked)}
        />
        {t("trim.embeddedSubtitles")}
      </label>
      <p>{t("trim.subtitleNote")}</p>
      <p>
        {t("trim.estimate")}:{" "}
        <bdi>{estimate ? `≈ ${bytes(estimate)}` : t("common.unknown")}</bdi> ·{" "}
        <bdi>{length.toFixed(3)} s</bdi>
      </p>
      <small>
        {t(
          value.mode === "fast" ? "trim.estimateFast" : "trim.estimatePrecise",
        )}
      </small>
      {seekable && timeSaving > 0 && (
        <small>{t("trim.sectionTimeSaving", { percent: timeSaving })}</small>
      )}
      {value.container === "mp4" && <small>{t("trim.mp4Note")}</small>}
    </section>
  );
}
