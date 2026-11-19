const { randomUUID } = require("node:crypto");
const { YtDlpWrapper } = require("./YtDlpWrapper");
const { StreamSniffer } = require("./StreamSniffer");
const { validateUrl } = require("../engine/utils");
const { fetchTikTokPreview } = require("./TikTokPreview");
const { PlaybackCapture } = require("./PlaybackCapture");

class MediaDetector {
  constructor({ binPath, onMedia, wrapper } = {}) {
    this.ytdlp = wrapper || new YtDlpWrapper({ binPath });
    this.sniffer = new StreamSniffer({ onMedia });
    this.analyses = new Map();
    this.activeAnalyses = new Map();
    this.captures = new PlaybackCapture();
  }
  capture(data) {
    return this.captures.record(data);
  }
  captured(url) {
    return this.captures.find(url);
  }
  capturedSelection(url, captureId) {
    return this.captures.resolve(url, captureId);
  }
  releaseIdleMetadata() {
    // A new renderer must analyze its page again after tray teardown.
    // Keep tiny short-lived playback captures for incoming browser requests.
    this.analyses.clear();
  }
  async detect(url) {
    return this.getFormats(url);
  }
  async preview(url) {
    return fetchTikTokPreview(url);
  }
  async getFormats(url, options) {
    url = validateUrl(url);
    const { result, tools } = await this.runAnalysis(options, async (request) => ({
      result: await this.ytdlp.getFormats(url, request),
      tools: await this.ytdlp.availability(),
    }));
    const analysisId = randomUUID();
    for (const [key, value] of this.analyses)
      if (Date.now() - value.createdAt > 30 * 60 * 1000)
        this.analyses.delete(key);
    this.analyses.set(analysisId, {
      ...result,
      originalUrl: url,
      createdAt: Date.now(),
    });
    while (this.analyses.size > 20)
      this.analyses.delete(this.analyses.keys().next().value);
    return { ...result, analysisId, tools };
  }
  async runAnalysis(options, extract) {
    const requestId = options?.requestId;
    const controller = requestId ? new AbortController() : null;
    if (requestId) {
      this.cancelAnalysis(requestId);
      this.activeAnalyses.set(requestId, controller);
    }
    try {
      const result = await extract({
        ...options,
        ...(controller ? { signal: controller.signal } : {}),
      });
      controller?.signal.throwIfAborted();
      return result;
    } finally {
      if (requestId && this.activeAnalyses.get(requestId) === controller)
        this.activeAnalyses.delete(requestId);
    }
  }
  cancelAnalysis(requestId) {
    if (typeof requestId !== "string" || requestId.length > 64) return false;
    const controller = this.activeAnalyses.get(requestId);
    if (!controller) return false;
    this.activeAnalyses.delete(requestId);
    controller.abort();
    return true;
  }
  async getPlaylist(url, options) {
    url = validateUrl(url);
    return this.runAnalysis(options, (request) =>
      this.ytdlp.getPlaylist(url, request),
    );
  }
  analysis(analysisId) {
    const analysis = this.analyses.get(analysisId);
    if (!analysis || Date.now() - analysis.createdAt > 30 * 60 * 1000)
      throw new Error("This format list has expired. Analyze the URL again.");
    return analysis;
  }
  selection({
    analysisId,
    formatId,
    segment,
    exportOptions = {},
    audioFormatId,
  }) {
    const analysis = this.analysis(analysisId);
    const format = analysis.formats.find(
      (value) => value.formatId === formatId,
    );
    if (!format) throw new Error("Choose an available video or audio format.");
    let validatedSegment = null;
    if (segment != null) {
      if (format.group !== "video" || format.hasVideo === false)
        throw new Error("Segments are available for video formats only.");
      if (analysis.live || !Number.isFinite(analysis.duration))
        throw new Error("A reliable duration is required to select a segment.");
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end > analysis.duration ||
        end - start < 0.001
      )
        throw new Error(
          "Choose a valid video segment with a positive duration.",
        );
      validatedSegment =
        start <= 0 && end >= analysis.duration ? null : { start, end };
    }
    const audio = audioFormatId
      ? analysis.formats.find(
          (value) =>
            value.formatId === audioFormatId && value.group === "audio",
        )
      : null;
    if (audioFormatId && !audio)
      throw new Error("Choose an available audio track.");
    const estimateFormatSize = (value) => {
      const known = Number(value?.filesize) || 0;
      if (known > 0)
        return { bytes: known, approximate: value.approximateSize === true };
      const bitrate = Number(value?.bitrate) || 0;
      const duration = Number(analysis.duration) || 0;
      if (bitrate <= 0 || duration <= 0) return { bytes: 0, approximate: true };
      const bytes = Math.round((bitrate * 1000 * duration) / 8);
      return {
        bytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0,
        approximate: true,
      };
    };
    const formatEstimate = estimateFormatSize(format);
    const audioEstimate = estimateFormatSize(audio);
    let estimatedTotalSize = format.mergeAudio
      ? audio && formatEstimate.bytes && audioEstimate.bytes
        ? formatEstimate.bytes + audioEstimate.bytes
        : 0
      : formatEstimate.bytes;
    if (estimatedTotalSize && validatedSegment && analysis.duration > 0)
      estimatedTotalSize = Math.max(
        1,
        Math.round(
          (estimatedTotalSize *
            (validatedSegment.end - validatedSegment.start)) /
            analysis.duration,
        ),
      );
    const mode = exportOptions.mode || "precise";
    const container = exportOptions.container || "mkv";
    const quality = exportOptions.quality || "high";
    if (
      !["fast", "precise"].includes(mode) ||
      !["mkv", "mp4"].includes(container) ||
      !["high", "balanced", "small"].includes(quality)
    )
      throw new Error("Unsupported export options.");
    let requestedContainer = format.ext;
    if (format.mergeAudio && !(
      (format.ext === "mp4" && audio?.ext === "m4a") ||
      (format.ext === "webm" && audio?.ext === "webm")
    ))
      requestedContainer = null;
    return {
      url: analysis.originalUrl,
      posterUrl: analysis.thumbnail,
      media: {
        type: "video",
        title: analysis.title,
        formatId: format.formatId,
        mergeAudio: format.mergeAudio,
        live: analysis.live,
        audioOnly: format.group === "audio",
        ext: format.ext,
        requestedContainer: validatedSegment ? container : requestedContainer,
        videoCodec: format.vcodec || null,
        audioCodec: audio?.acodec || format.acodec || null,
        quality: format.quality,
        estimatedTotalSize,
        estimatedSizeApproximate:
          formatEstimate.approximate ||
          (format.mergeAudio && audioEstimate.approximate) ||
          !!format.mergeAudio ||
          !!validatedSegment,
        audioUnknown: format.audioUnknown,
        segment: validatedSegment,
        seekableSection:
          String(analysis.extractor).toLowerCase() === "youtube" &&
          /^https?$/.test(format.protocol || "") &&
          (!audio || /^https?$/.test(audio.protocol || "")),
        audioFormatId: audio?.formatId,
        exportOptions: {
          mode,
          container,
          quality,
          audio: exportOptions.audio === "none" ? "none" : "all",
          subtitles: exportOptions.subtitles === true,
        },
      },
    };
  }
  subtitleSelection({ analysisId, languageId, format }) {
    const analysis = this.analysis(analysisId);
    const subtitle = analysis.subtitles.find((item) => item.id === languageId);
    if (!subtitle) throw new Error("Choose an available subtitle language.");
    if (!["srt", "vtt"].includes(format))
      throw new Error("Choose SRT or VTT subtitles.");
    return {
      url: analysis.originalUrl,
      media: {
        type: "subtitle",
        title: analysis.title,
        ext: format,
        requestedContainer: format,
        quality: `${subtitle.language} · ${format.toUpperCase()}`,
        subtitle: {
          language: subtitle.language,
          automatic: subtitle.automatic,
          format,
          sourceFormats: subtitle.formats,
          ...(Object.keys(subtitle.sources || {}).length
            ? { sources: subtitle.sources }
            : {}),
        },
      },
    };
  }
  thumbnailSelection({ analysisId, thumbnailId }) {
    const analysis = this.analysis(analysisId);
    const thumbnail = analysis.thumbnails.find(
      (item) => item.id === thumbnailId,
    );
    if (!thumbnail) throw new Error("Choose an available thumbnail image.");
    return {
      url: thumbnail.url,
      filename: `${analysis.title} [${thumbnail.label}].${thumbnail.ext}`,
      headers: thumbnail.httpHeaders,
    };
  }
  inspect(details) {
    return this.sniffer.inspect(details);
  }
}
module.exports = { MediaDetector };
