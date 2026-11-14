import VideoPreview from "../components/VideoPreview";
import ExportOptions from "../components/ExportOptions";
import DestinationPreview from "../components/DestinationPreview";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LuAudioLines,
  LuFilm,
  LuSearch,
  LuArrowDownToLine,
  LuCheck,
  LuLink,
  LuInfo,
  LuExternalLink,
  LuSparkles,
  LuImage,
  LuFileText,
  LuTags,
  LuCaptions,
  LuX,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import {
  Button,
  ErrorBanner,
  Field,
  FolderField,
  IconButton,
  PageHeader,
  Select,
} from "../components/ui";
import MediaMetadata from "../components/MediaMetadata";
import VideoSegmentSelector from "../components/VideoSegmentSelector";
import VirtualList from "../components/VirtualList";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { bytes, duration } from "../utils/format";
import { choosePlaylistFormat } from "../utils/playlist-formats.mjs";
import { choosePreferredMediaFormat } from "../utils/choose-media-format.mjs";
import { useI18n } from "../i18n/useI18n";
export default function MediaPage({ tools }) {
  const { t } = useI18n();
  const url = useUIStore((state) => state.mediaUrl),
    setUrl = useUIStore((state) => state.setMediaUrl),
    mediaRequest = useUIStore((state) => state.mediaRequest);
  const settings = useSettingsStore((state) => state.settings);
  const [showVariants, setShowVariants] = useState(false);
  const [result, setResult] = useState(null),
    [selected, setSelected] = useState(null),
    [group, setGroup] = useState("video"),
    [folder, setFolder] = useState(settings.defaultDownloadPath || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null),
    [captured, setCaptured] = useState(null),
    [capturedBusy, setCapturedBusy] = useState(false),
    [adding, setAdding] = useState(false),
    [section, setSection] = useState("media"),
    [withSubtitles, setWithSubtitles] = useState(false),
    [subtitleLanguage, setSubtitleLanguage] = useState(""),
    [subtitleFormat, setSubtitleFormat] = useState("vtt"),
    [segment, setSegment] = useState(null);
  const [playlist, setPlaylist] = useState(null),
    [playlistSelection, setPlaylistSelection] = useState(() => new Set()),
    [playlistQuality, setPlaylistQuality] = useState(() =>
      settings.mediaPreferences?.height
        ? String(settings.mediaPreferences.height)
        : "highest",
    ),
    [playlistFormat, setPlaylistFormat] = useState("video"),
    [playlistBusy, setPlaylistBusy] = useState(false),
    [playlistProgress, setPlaylistProgress] = useState(null),
    [playlistFailures, setPlaylistFailures] = useState([]);
  const playlistRequest = useRef(null);
  useEffect(
    () =>
      api.on("media:playlist-progress", ({ requestId, count }) => {
        if (playlistRequest.current === requestId)
          setPlaylistProgress({ phase: "extracting", count });
      }),
    [],
  );
  const playlistGetKey = useCallback((item) => item.url, []);
  const renderPlaylistEntry = useCallback(
    (entry, index) => (
      <label className="playlist-row">
        <input
          type="checkbox"
          checked={playlistSelection.has(index)}
          onChange={() =>
            setPlaylistSelection((old) => {
              const next = new Set(old);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            })
          }
        />
        <span>{entry.title}</span>
        <small>{entry.duration ? duration(entry.duration) : ""}</small>
      </label>
    ),
    [playlistSelection],
  );
  useEffect(() => api.on("media:captured", (capture) => {
    const pageId = /\/video\/(\d+)/.exec(url)?.[1];
    const captureId = /\/video\/(\d+)/.exec(capture.postUrl)?.[1];
    if (pageId && pageId === captureId) setCaptured(capture);
  }), [url]);
  const generation = useRef(0),
    lastAuto = useRef(0);
  const clearLink = () => {
    // Invalidate any in-flight analysis so its result cannot repopulate the
    // input or the format list after the user cleared the link.
    generation.current++;
    lastAuto.current = 0;
    setUrl("");
    setResult(null);
    setPreview(null);
    setCaptured(null);
    setSelected(null);
    setSegment(null);
    setError("");
    setBusy(false);
    document.getElementById("media-url")?.focus();
  };
  const analyze = async (event) => {
    event?.preventDefault();
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    setPreview(null);
    setCaptured(null);
    setSelected(null);
    setSegment(null);
    setSection("media");
    setWithSubtitles(false);
    try {
      if (!/^https?:\/\//i.test(url.trim()))
        throw new Error(t("media.invalidUrl"));
      const mediaUrl = url.trim();
      // Run quick public TikTok preview alongside extraction, not ahead of it.
      // The generation guard keeps stale requests from repainting the page.
      const formatsPromise = api.invoke("media:get-formats", mediaUrl);
      // Already observed browser streams do not need another webpage parse.
      // Show the direct option immediately; full qualities load separately.
      api.invoke("media:captured", mediaUrl)
        .then((data) => {
          if (current === generation.current && data) setCaptured(data);
        })
        .catch(() => {});
      if (/^https:\/\/(?:www\.|m\.)?tiktok\.com\//i.test(mediaUrl))
        api.invoke("media:preview", mediaUrl)
          .then((data) => {
            if (current === generation.current && data) setPreview(data);
          })
          .catch(() => {});
      const info = await formatsPromise;
      if (current !== generation.current) return;
      setResult(info);
      setSubtitleLanguage(
        info.subtitles.find(
          (s) => s.id === settings.mediaPreferences?.subtitleLanguage,
        )?.id ||
          info.subtitles[0]?.id ||
          "",
      );
      const preferred = choosePreferredMediaFormat(
        info.formats,
        settings.mediaPreferences,
        info.tools,
      );
      setGroup(preferred?.group || "video");
      setSelected(preferred?.formatId || null);
      if (!info.formats.length) setError(t("media.noFormats"));
    } catch (error) {
      if (current === generation.current) setError(errorMessage(error));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const loadPlaylist = async () => {
    const requestId = crypto.randomUUID();
    playlistRequest.current = requestId;
    setPlaylistBusy(true);
    setPlaylistProgress({ phase: "extracting", count: 0 });
    setPlaylistFailures([]);
    setError("");
    try {
      const result = await api.invoke(
        "media:get-playlist",
        url.trim(),
        requestId,
      );
      if (playlistRequest.current !== requestId) return;
      setPlaylist(result);
      setPlaylistSelection(new Set(result.entries.map((_, index) => index)));
    } catch (error) {
      if (playlistRequest.current === requestId) setError(errorMessage(error));
    } finally {
      if (playlistRequest.current === requestId) {
        playlistRequest.current = null;
        setPlaylistBusy(false);
        setPlaylistProgress(null);
      }
    }
  };
  const queuePlaylist = async () => {
    if (!playlistSelection.size) return;
    setPlaylistBusy(true);
    setPlaylistFailures([]);
    setError("");
    const selectedEntries = [...playlistSelection].map(
      (index) => playlist.entries[index],
    );
    const total = selectedEntries.length;
    setPlaylistProgress({ phase: "queuing", count: 0, total });
    let queued = 0;
    let skipped = 0;
    const failures = [];
    for (const [index, entry] of selectedEntries.entries()) {
      try {
        const info = await api.invoke("media:get-formats", entry.url);
        const cap =
          playlistQuality === "highest" ? Infinity : Number(playlistQuality);
        const format = choosePlaylistFormat(info.formats, playlistFormat, cap);
        if (!format) throw new Error(t("media.playlistNoFormat"));
        await api.invoke("media:download", {
          analysisId: info.analysisId,
          formatId: format.formatId,
          ...(folder !== settings.defaultDownloadPath
            ? { savePath: folder }
            : {}),
        });
        queued++;
      } catch (error) {
        skipped++;
        if (failures.length < 10)
          failures.push({ title: entry.title, reason: errorMessage(error) });
      }
      setPlaylistProgress({ phase: "queuing", count: index + 1, total });
    }
    setPlaylistFailures(failures);
    setPlaylistProgress(null);
    setPlaylistBusy(false);
    useUIStore
      .getState()
      .notify(
        t("media.playlistQueued", { count: queued }) +
          (skipped ? ` ${t("media.playlistSkipped", { count: skipped })}` : ""),
      );
    if (!skipped) useUIStore.getState().setActiveTab("all");
  };
  useEffect(() => {
    if (mediaRequest && lastAuto.current !== mediaRequest && url) {
      lastAuto.current = mediaRequest;
      analyze();
    }
  }, [mediaRequest]);
  useEffect(
    () => () => {
      generation.current++;
      lastAuto.current = 0;
    },
    [],
  );
  const format = result?.formats.find((item) => item.formatId === selected);
  const [exportOptions, setExportOptions] = useState({
    mode: "precise",
    container: "mkv",
    quality: "high",
    audio: "all",
    subtitles: false,
  });
  const [audioFormatId, setAudioFormatId] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  useEffect(() => setShowEditor(false), [result?.analysisId]);
  useEffect(() => {
    const preferred = result?.formats.find(
      (f) =>
        f.group === "audio" &&
        settings.mediaPreferences?.audioLanguage &&
        f.language === settings.mediaPreferences.audioLanguage,
    );
    setAudioFormatId(preferred?.formatId || "");
  }, [result?.analysisId]);
  const partialSegment = group === "video" && !!segment;
  const addCaptured = async () => {
    if (!captured) return;
    setCapturedBusy(true);
    setError("");
    try {
      await api.invoke("media:download-captured", {
        pageUrl: url.trim(),
        captureId: captured.id,
        posterUrl: preview?.thumbnail || null,
        ...(folder !== settings.defaultDownloadPath ? { savePath: folder } : {}),
      });
      useUIStore.getState().notify("Browser playback queued for download.");
      useUIStore.getState().setActiveTab("all");
    } catch (cause) {
      setError(errorMessage(cause));
      // Keep the regular format picker available after a stream expires.
      setCaptured(null);
    } finally { setCapturedBusy(false); }
  };
  const add = async () => {
    setAdding(true);
    setError("");
    try {
      await api.invoke("media:download", {
        analysisId: result.analysisId,
        formatId: format.formatId,
        audioFormatId: format.mergeAudio ? audioFormatId : undefined,
        ...(segment && group === "video"
          ? {
              segment,
              exportOptions,
              audioFormatId: format.mergeAudio ? audioFormatId : undefined,
            }
          : {}),
        ...(withSubtitles && subtitleLanguage
          ? {
              subtitle: {
                languageId: subtitleLanguage,
                format: subtitleFormat,
              },
            }
          : {}),
        ...(folder !== settings.defaultDownloadPath
          ? { savePath: folder }
          : {}),
      });
      useUIStore
        .getState()
        .notify(
          partialSegment
            ? t("media.segment.queued")
            : withSubtitles
              ? t("media.addedWithSubtitles")
              : t("media.added"),
        );
      useUIStore.getState().setActiveTab("all");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAdding(false);
    }
  };
  return (
    <div className="page media-page">
      <PageHeader title={t("media.title")}>
        <span className={`engine-label ${tools.ytdlp ? "ready" : ""}`}>
          <span className="status-dot" />
          {tools.ytdlp ? t("media.engineReady") : t("media.engineMissing")}
        </span>
      </PageHeader>
      {!tools.ytdlp && (
        <ErrorBanner>{t("media.engineMissingBanner")}</ErrorBanner>
      )}
      <form className="media-search-panel" onSubmit={analyze}>
        <Field label={t("media.pageLabel")} id="media-url">
          <div className="media-search">
            <LuLink />
            <div className="media-field">
              <input
                id="media-url"
                type="url"
                required
                dir="ltr"
                placeholder={t("media.urlPlaceholder")}
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setPlaylist(null);
                  setPlaylistSelection(new Set());
                  if (result) {
                    setResult(null);
                    setSelected(null);
                  }
                }}
                spellCheck="false"
                autoComplete="off"
              />
              {url && (
                <button
                  type="button"
                  className="clear-link"
                  title={t("media.clearLink")}
                  aria-label={t("media.clearLink")}
                  onClick={clearLink}
                >
                  <LuX />
                </button>
              )}
            </div>
            <Button
              type="submit"
              icon={LuSearch}
              variant="primary"
              busy={busy}
              disabled={!url.trim() || !tools.ytdlp}
            >
              {t("media.analyze")}
            </Button>
            <Button
              type="button"
              icon={LuFilm}
              busy={playlistBusy}
              disabled={!url.trim() || !tools.ytdlp}
              onClick={loadPlaylist}
            >
              {t("media.loadPlaylist")}
            </Button>
          </div>
        </Field>
        <div className="media-search-note">
          <span>{t("media.disclaimer")}</span>
        </div>
      </form>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {playlistProgress && (
        <div className="playlist-progress" role="status">
          <span>
            {t(
              playlistProgress.phase === "extracting"
                ? "media.playlistExtracting"
                : "media.playlistQueuing",
              playlistProgress,
            )}
          </span>
          <progress
            aria-label={t("media.playlistProgress")}
            {...(playlistProgress.total
              ? { max: playlistProgress.total, value: playlistProgress.count }
              : {})}
          />
        </div>
      )}
      {playlist && (
        <section className="playlist-panel">
          <div className="playlist-heading">
            <div>
              <h2>{playlist.title}</h2>
              <p>
                {t("media.playlistCount", { count: playlist.entries.length })}
              </p>
            </div>
            <Button
              variant="primary"
              busy={playlistBusy}
              disabled={!playlistSelection.size}
              onClick={queuePlaylist}
            >
              {t("media.queueSelected", { count: playlistSelection.size })}
            </Button>
          </div>
          <div className="playlist-toolbar">
            <Button
              variant="ghost"
              onClick={() =>
                setPlaylistSelection(
                  new Set(playlist.entries.map((_, index) => index)),
                )
              }
            >
              {t("media.selectAll")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setPlaylistSelection(new Set())}
            >
              {t("media.deselectAll")}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setPlaylistSelection(
                  (old) =>
                    new Set(
                      playlist.entries
                        .map((_, index) => (!old.has(index) ? index : null))
                        .filter((index) => index !== null),
                    ),
                )
              }
            >
              {t("media.invertSelection")}
            </Button>
            <label>
              {t("media.playlistFormat")}
              <Select
                value={playlistFormat}
                onChange={(event) => setPlaylistFormat(event.target.value)}
              >
                <option value="video">{t("media.playlistBestVideo")}</option>
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="audio">{t("media.playlistBestAudio")}</option>
                <option value="m4a">M4A</option>
                <option value="opus">Opus</option>
              </Select>
            </label>
            <label>
              {t("media.applyQuality")}{" "}
              <Select
                value={playlistQuality}
                onChange={(event) => setPlaylistQuality(event.target.value)}
              >
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="highest">{t("media.playlistHighest")}</option>
              </Select>
            </label>
          </div>
          {!!playlistFailures.length && (
            <ul className="playlist-errors">
              {playlistFailures.map((entry, index) => (
                <li key={index}>
                  <strong>{entry.title}</strong> <span>{entry.reason}</span>
                </li>
              ))}
            </ul>
          )}
          <VirtualList
            items={playlist.entries}
            getKey={playlistGetKey}
            estimate={54}
            className="playlist-list"
            renderItem={renderPlaylistEntry}
          />
        </section>
      )}
      {captured && (
        <section className="media-capture-option" aria-label="Detected TikTok playback">
          <div className="media-capture-description">
            <span className="eyebrow">FAST PLAYBACK CAPTURE</span>
            <strong>Ready from your browser</strong>
            <span>Download the stream TikTok is currently playing without waiting for full format analysis.</span>
            <small>Current playback quality only · Other qualities load separately · The stream may expire.</small>
          </div>
          <Button variant="primary" icon={LuArrowDownToLine}
            busy={capturedBusy} onClick={addCaptured}>
            Download now
          </Button>
        </section>
      )}
      {busy && (
        <div className="analysis-loading" role="status" aria-live="polite">
          {preview && (
            <div className="quick-media-preview">
              <img
                src={preview.thumbnail}
                alt={t("media.previewAlt")}
                referrerPolicy="no-referrer"
                onError={(event) => { event.currentTarget.hidden = true; }}
              />
              <div>
                <span className="eyebrow">TikTok</span>
                <strong>{preview.title || preview.author || "TikTok video"}</strong>
                {preview.author && <small>{preview.author}</small>}
              </div>
            </div>
          )}
          <div className="loader-ring" />
          <h2>{captured ? "More quality options loading" : t("media.loadingTitle")}</h2>
          <p>{captured ? "Your browser playback is ready to download above. Additional formats are loading in the background." : t("media.loadingText")}</p>
          <span>{t("media.loadingNote")}</span>
        </div>
      )}
      {!busy && result && (
        <section className="media-result">
          <div className="media-result-header">
            {result.thumbnail ? (
              <img
                className="media-thumbnail"
                src={result.thumbnail}
                alt={t("media.previewAlt")}
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            ) : (
              <div className="media-thumbnail fallback">
                <LuFilm />
              </div>
            )}
            <div>
              <span className="eyebrow">
                {result.extractor || t("media.source")}{" "}
                {result.duration ? `· ${duration(result.duration)}` : ""}
              </span>
              <h2>{result.title}</h2>
              <p>{t("media.formatsCount", { count: result.formats.length })}</p>
            </div>
          </div>
          <div
            className="media-section-tabs"
            role="tablist"
            aria-label={t("media.toolsLabel")}
          >
            {[
              ["media", LuFilm, "media.tab.media", result.formats.length],
              [
                "thumbnails",
                LuImage,
                "media.tab.thumbnails",
                result.thumbnails.length,
              ],
              ["description", LuFileText, "media.tab.description", null],
              ["tags", LuTags, "media.tab.tags", result.tags.length],
              [
                "subtitles",
                LuCaptions,
                "media.tab.subtitles",
                result.subtitles.length,
              ],
            ].map(([id, Icon, labelKey, count]) => (
              <button
                key={id}
                role="tab"
                aria-selected={section === id}
                onClick={() => setSection(id)}
              >
                <Icon />
                {t(labelKey)}
                {count != null && <span>{count}</span>}
              </button>
            ))}
          </div>
          {section === "media" && (
            <div className="media-result-body">
              <div className="format-panel">
                <div
                  className="format-tabs"
                  role="tablist"
                  aria-label={t("media.formatTypeLabel")}
                >
                  {[
                    ["video", LuFilm, "media.video"],
                    ["audio", LuAudioLines, "media.audioOnly"],
                  ].map(([key, Icon, labelKey]) => (
                    <button
                      role="tab"
                      aria-selected={group === key}
                      key={key}
                      onClick={() => {
                        setGroup(key);
                        if (key !== "video") setSegment(null);
                        const first = result.formats.find(
                          (item) => item.group === key,
                        );
                        setSelected(first?.formatId || null);
                      }}
                    >
                      <Icon />
                      {t(labelKey)}
                      <span>
                        {
                          result.formats.filter((item) => item.group === key)
                            .length
                        }
                      </span>
                    </button>
                  ))}
                </div>
                <div className="format-variants">
                  <Button onClick={() => setShowVariants((v) => !v)}>
                    {t(
                      showVariants
                        ? "enhance.hideVariants"
                        : "enhance.showVariants",
                    )}
                  </Button>
                  <small>{t("enhance.codecNote")}</small>
                </div>
                <div className="format-heading">
                  <span>{t("media.qualityFormat")}</span>
                  <span>{t("media.size")}</span>
                </div>
                <div
                  className="format-list"
                  role="radiogroup"
                  aria-label={t("media.formatGroup", {
                    group: t(
                      group === "audio" ? "media.audioOnly" : "media.video",
                    ),
                  })}
                >
                  {result.formats
                    .filter((item) => item.group === group)
                    .filter(
                      (item, index, list) =>
                        showVariants ||
                        item.formatId === selected ||
                        list.findIndex((f) =>
                          group === "video"
                            ? f.height === item.height
                            : f.ext === item.ext &&
                              f.language === item.language,
                        ) === index,
                    )
                    .map((item) => (
                      <label
                        key={item.formatId}
                        className={`format-option ${selected === item.formatId ? "selected" : ""} ${item.mergeAudio && !result.tools.ffmpeg ? "unavailable" : ""}`}
                      >
                        <input
                          type="radio"
                          name="media-format"
                          value={item.formatId}
                          checked={selected === item.formatId}
                          disabled={item.mergeAudio && !result.tools.ffmpeg}
                          onChange={() => setSelected(item.formatId)}
                        />
                        <span className="format-radio">
                          <LuCheck />
                        </span>
                        <div className="format-description">
                          <strong>
                            {item.quality} <span>{item.ext.toUpperCase()}</span>
                            {item.fps > 30 && <span>{item.fps} FPS</span>}
                          </strong>
                          <small>
                            {[
                              item.resolution,
                              item.vcodec?.split(".")[0],
                              item.acodec?.split(".")[0],
                              item.language,
                              item.mergeAudio
                                ? t("media.audioMerged")
                                : item.hasVideo
                                  ? item.audioUnknown
                                    ? t("media.audioNotReported")
                                    : item.hasAudio
                                      ? t("media.videoAudio")
                                      : t("media.videoOnlyNoAudio")
                                  : item.audioChannels
                                    ? t("media.channels", {
                                        count: item.audioChannels,
                                      })
                                    : t("media.audioStream"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </div>
                        <span className="format-size">
                          {item.filesize
                            ? `${item.approximateSize ? "≈ " : ""}${bytes(item.filesize)}`
                            : t("media.unknownSize")}
                          {item.mergeAudio && item.filesize ? (
                            <small>{t("media.plusAudio")}</small>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  {!result.formats.some((item) => item.group === group) && (
                    <div className="format-empty">
                      {t("media.noGroupFormats", {
                        group: t(
                          group === "audio"
                            ? "media.groupAudio"
                            : "media.groupVideo",
                        ),
                      })}
                    </div>
                  )}
                </div>
                <p className="format-footnote">
                  <LuInfo />
                  {t("media.formatFootnote")}
                </p>
              </div>
              <aside className="media-output">
                <div className="eyebrow">{t("media.yourDownload")}</div>
                <div className="selected-quality">
                  {format?.quality || t("media.chooseFormat")}
                  <span>{format?.ext.toUpperCase()}</span>
                </div>
                <dl>
                  <div>
                    <dt>{t("media.content")}</dt>
                    <dd>
                      {format?.group === "audio"
                        ? t("media.audioOnlyContent")
                        : format?.audioUnknown
                          ? t("media.tracksUnreported")
                          : format?.hasAudio || format?.mergeAudio
                            ? t("media.videoWithAudio")
                            : t("media.videoOnly")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("media.audio")}</dt>
                    <dd>
                      {format?.mergeAudio
                        ? t("media.mergedFfmpeg")
                        : format?.hasAudio
                          ? t("media.included")
                          : format?.audioUnknown
                            ? t("media.audioNotReported")
                            : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("media.fileSize")}</dt>
                    <dd>
                      {format?.filesize
                        ? `${format.approximateSize ? "≈ " : ""}${bytes(format.filesize)}${format.mergeAudio ? ` ${t("media.plusAudio")}` : ""}`
                        : t("common.notProvided")}
                    </dd>
                  </div>
                </dl>
                <FolderField
                  value={folder}
                  onChange={setFolder}
                  id="media-folder"
                />
                {group === "video" &&
                  result.duration > 0 &&
                  !result.live &&
                  result.tools.ffmpeg && (
                    <Button
                      aria-expanded={showEditor}
                      aria-controls="media-segment-editor"
                      onClick={() => setShowEditor((open) => !open)}
                    >
                      {t(showEditor ? "trim.closeEditor" : "trim.openEditor")}
                    </Button>
                  )}
                {group === "video" && (result.live || !result.duration) && (
                  <div className="segment-unavailable">
                    {result.live
                      ? t("media.segment.liveUnavailable")
                      : t("media.segment.durationUnavailable")}
                  </div>
                )}
                {group === "video" &&
                  result.duration >= 1 &&
                  !result.live &&
                  !result.tools.ffmpeg && (
                    <div className="segment-unavailable">
                      {t("media.segment.ffmpegUnavailable")}
                    </div>
                  )}
                {group === "video" && result.subtitles.length > 0 && (
                  <div className="subtitle-companion">
                    <label>
                      <input
                        type="checkbox"
                        checked={withSubtitles}
                        onChange={(event) =>
                          setWithSubtitles(event.target.checked)
                        }
                      />
                      {partialSegment
                        ? t("trim.includeCaptions")
                        : t("media.includeSubtitles")}
                    </label>
                    {withSubtitles && (
                      <div>
                        <Select
                          aria-label={t("media.subtitleLanguage")}
                          value={subtitleLanguage}
                          onChange={(event) =>
                            setSubtitleLanguage(event.target.value)
                          }
                        >
                          {result.subtitles.map((subtitle) => (
                            <option key={subtitle.id} value={subtitle.id}>
                              {subtitle.name}
                              {subtitle.automatic ? t("media.autoSuffix") : ""}
                            </option>
                          ))}
                        </Select>
                        <Select
                          aria-label={t("media.subtitleFormat")}
                          value={subtitleFormat}
                          onChange={(event) =>
                            setSubtitleFormat(event.target.value)
                          }
                        >
                          <option value="vtt">VTT</option>
                          <option value="srt">SRT</option>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
                <Button
                  variant="primary"
                  icon={LuArrowDownToLine}
                  busy={adding}
                  disabled={
                    !format ||
                    !folder ||
                    (withSubtitles && !partialSegment && !subtitleLanguage) ||
                    (format.mergeAudio && !result.tools.ffmpeg)
                  }
                  onClick={add}
                >
                  {t(
                    partialSegment
                      ? "media.segment.download"
                      : group === "audio"
                        ? "media.downloadAudio"
                        : "media.downloadVideo",
                  )}
                </Button>
                <p>
                  {partialSegment
                    ? t("media.segment.progressNote")
                    : t("media.progressNote")}
                </p>
                {!result.tools.ffmpeg && (
                  <div className="small-warning">
                    {t("media.ffmpegMissing")}
                  </div>
                )}
              </aside>
              {showEditor &&
                group === "video" &&
                result.duration > 0 &&
                !result.live &&
                result.tools.ffmpeg && (
                  <section
                    id="media-segment-editor"
                    className="media-editor"
                    aria-label={t("media.segment.title")}
                  >
                    <VideoPreview
                      result={result}
                      format={format}
                      segment={segment}
                      onChange={setSegment}
                    />
                    <VideoSegmentSelector
                      fps={format?.fps || 30}
                      duration={result.duration}
                      value={segment}
                      onChange={setSegment}
                    />
                    {segment && (
                      <ExportOptions
                        value={exportOptions}
                        onChange={setExportOptions}
                        format={format}
                        result={result}
                        segment={segment}
                        audioFormatId={audioFormatId}
                        onAudioChange={setAudioFormatId}
                      />
                    )}
                    <DestinationPreview
                      url={url}
                      media={{ type: "video", audioOnly: false }}
                      savePath={
                        folder !== settings.defaultDownloadPath
                          ? folder
                          : undefined
                      }
                    />
                    <div className="media-editor-actions">
                      <Button
                        variant="primary"
                        icon={LuArrowDownToLine}
                        busy={adding}
                        disabled={
                          !format ||
                          !folder ||
                          (withSubtitles && !subtitleLanguage)
                        }
                        onClick={add}
                      >
                        {t(
                          segment
                            ? "media.segment.download"
                            : "media.downloadVideo",
                        )}
                      </Button>
                      <Button onClick={() => setShowEditor(false)}>
                        {t("trim.closeEditor")}
                      </Button>
                    </div>
                  </section>
                )}
            </div>
          )}
          {section !== "media" && (
            <MediaMetadata
              section={section}
              result={result}
              savePath={
                folder !== settings.defaultDownloadPath ? folder : undefined
              }
              onError={setError}
            />
          )}
        </section>
      )}
      {!busy && !result && !error && (
        <div className="media-intro">
          <div className="media-intro-icon">
            <LuFilm />
            <LuAudioLines />
          </div>
          <h2>{t("media.introTitle")}</h2>
          <p>{t("media.introDescription")}</p>
          <div className="media-capabilities">
            <span>
              <LuCheck />
              {t("media.capVideoAudio")}
            </span>
            <span>
              <LuCheck />
              {t("media.capAudioOnly")}
            </span>
            <span>
              <LuCheck />
              {t("media.capProgress")}
            </span>
          </div>
          <p className="media-limit-note">
            {t("media.availabilityNote")}
            <br />
            {t("media.privateNote")}
          </p>
        </div>
      )}
    </div>
  );
}
