const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { sanitizeFilename } = require("../engine/utils");
const {
  captionRateLimit,
  checkCaptionCooldown,
  convertCaptions,
  fetchCaption,
  recordCaptionCooldown,
} = require("./subtitles");
const { validateMediaOutput } = require("./media-integrity");
const { publishFile } = require("../engine/transfer-integrity");
const { trimVideo } = require("./VideoTrimmer");

function segmentStamp(seconds) {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}h${String(minutes).padStart(2, "0")}m${String(remainder).padStart(2, "0")}s`
    : `${String(minutes).padStart(2, "0")}m${String(remainder).padStart(2, "0")}s`;
}

class MediaEngine extends EventEmitter {
  constructor(
    options,
    wrapper,
    { validateOutput = validateMediaOutput, trimOutput = trimVideo } = {},
  ) {
    super();
    Object.assign(this, options);
    this.wrapper = wrapper;
    this.validateOutput = validateOutput;
    this.trimOutput = trimOutput;
    this.controller = new AbortController();
    this.status = "queued";
    this.tracks = new Map();
    this.speed = 0;
  }
  setStatus(status, data = {}) {
    this.status = status;
    this.emit("status", this.id, status, { speed: 0, ...data });
  }
  start() {
    if (!this.task) this.task = this.run();
    return this.task;
  }
  async run() {
    try {
      const media = this.media;
      if (
        (media?.type === "subtitle" && !media.subtitle?.language) ||
        (media?.type !== "subtitle" && !media?.formatId)
      )
        throw new Error(
          "The media selection is missing. Analyze the page again.",
        );
      this.setStatus(
        media.segment ? "downloading" : "connecting",
        media.segment
          ? { phase: "Downloading source for precise trimming" }
          : {
              totalSize: Number(media.estimatedTotalSize) || 0,
              approximateSize: media.estimatedSizeApproximate === true,
            },
      );
      await fs.mkdir(this.savePath, { recursive: true });
      // yt-dlp fragments and .part files stay in the private work folder. Only
      // the finished, verified file is published to the destination.
      this.workPath = this.tempPath || this.savePath;
      await fs.mkdir(this.workPath, { recursive: true });
      const segmentSuffix = media.segment
        ? `_${segmentStamp(media.segment.start)}-${segmentStamp(media.segment.end)}`
        : "";
      const stem = `${sanitizeFilename(media.title).slice(0, 140)}${segmentSuffix} [${this.id}]`;
      const outputTemplate =
        path.join(this.workPath, stem).replaceAll("%", "%%") + ".%(ext)s";
      let filePath;
      let downloadedSection = false;
      let warning = null;
      let captionRetryAt = null;
      const sourceKey = require("node:crypto")
        .createHash("sha256")
        .update(JSON.stringify([this.url, media.formatId, media.audioFormatId]))
        .digest("hex");
      const cacheFile = path.join(this.workPath, "source-cache.json");
      if (media.segment) {
        const cache = await fs
          .readFile(cacheFile, "utf8")
          .then(JSON.parse)
          .catch(() => null);
        if (
          cache?.key === sourceKey &&
          typeof cache.name === "string" &&
          path.basename(cache.name) === cache.name &&
          cache.name.startsWith(stem)
        ) {
          const cached = path.join(this.workPath, cache.name);
          const stat = await fs.stat(cached).catch(() => null);
          if (stat?.isFile() && stat.size > 0 && stat.size === cache.size)
            filePath = cached;
        }
      }
      if (filePath) {
        this.setStatus("processing", { stage: "trimming", stageProgress: 0 });
      } else if (media.type === "subtitle") {
        this.setStatus("downloading", { phase: "Downloading subtitles" });
        filePath = await this.downloadCaption(stem, media.subtitle);
      } else {
        const downloadSource = (template, section) =>
          this.wrapper.download({
            url: this.url,
            formatId: media.formatId,
            mergeAudio: media.mergeAudio,
            live: media.live,
            audioFormatId: media.audioFormatId,
            segment: media.segment,
            section,
            outputTemplate: template,
            speedLimit: this.speedLimit,
            timeout: this.timeout / 1000,
            signal: this.controller.signal,
            onFile: (value) => {
              filePath = value;
            },
            onProgress: (value) => {
              if (this.controller.signal.aborted) return;
              const key =
                value.filename || value.info_dict?.format_id || "stream";
              const previous = this.tracks.get(key);
              const received = Number(value.downloaded_bytes) || 0;
              const receivedAt = Date.now();
              const reportedSpeed = Number(value.speed) || 0;
              const trackSpeed =
                value.status === "downloading" && reportedSpeed > 0
                  ? previous?.speed > 0
                    ? previous.speed * 0.72 + reportedSpeed * 0.28
                    : reportedSpeed
                  : 0;
              this.tracks.set(key, {
                // yt-dlp can restart a fragment after a retry. Keep displayed
                // transferred bytes monotonic; the final published size
                // replaces this estimate when the download completes.
                bytes: Math.max(previous?.bytes || 0, received),
                total: Math.max(
                  previous?.total || 0,
                  Number(value.total_bytes || value.total_bytes_estimate) || 0,
                ),
                approximate:
                  previous?.approximate === true ||
                  (!value.total_bytes &&
                    Number(value.total_bytes_estimate) > 0),
                speed: trackSpeed,
                speedAt: receivedAt,
              });
              const tracks = [...this.tracks.values()];
              const downloadedSize = tracks.reduce(
                (sum, track) => sum + track.bytes,
                0,
              );
              // A finished video track is not the whole adaptive download.
              const reportedTotalSize =
                tracks.length >= (media.mergeAudio ? 2 : 1) &&
                tracks.every((track) => track.total > 0)
                  ? tracks.reduce((sum, track) => sum + track.total, 0)
                  : 0;
              const totalSize =
                reportedTotalSize || Number(media.estimatedTotalSize) || 0;
              const approximateSize = reportedTotalSize
                ? tracks.some((track) => track.approximate)
                : media.estimatedSizeApproximate === true;
              const now = Date.now();
              const sampledSpeed = tracks.reduce(
                (sum, track) =>
                  sum +
                  (now - (track.speedAt || 0) <= 2500 ? track.speed || 0 : 0),
                0,
              );
              this.speed =
                sampledSpeed > 0
                  ? this.speed > 0
                    ? this.speed * 0.7 + sampledSpeed * 0.3
                    : sampledSpeed
                  : 0;
              if (
                value.status === "downloading" &&
                this.status !== "downloading"
              )
                this.setStatus("downloading");
              const finalizing =
                value.status === "finished" &&
                tracks.length >= (media.mergeAudio ? 2 : 1);
              if (finalizing)
                this.setStatus("processing", {
                  phase: "Finalizing media",
                  stage: media.mergeAudio ? "merging" : "saving",
                  stageProgress: null,
                });
              this.emit("progress", this.id, {
                downloadedSize,
                totalSize,
                approximateSize:
                  totalSize > 0 &&
                  (reportedTotalSize
                    ? tracks.some((track) => track.approximate)
                    : media.estimatedSizeApproximate === true),
                speed: this.speed,
                eta:
                  this.speed > 0 &&
                  totalSize > downloadedSize &&
                  Number.isFinite(totalSize - downloadedSize)
                    ? (totalSize - downloadedSize) / this.speed
                    : null,
                phase: finalizing
                  ? "Finalizing media"
                  : section
                    ? "Downloading selected video interval"
                    : media.segment
                      ? "Downloading source for precise trimming"
                      : media.mergeAudio && tracks.length < 2
                        ? "Downloading video; audio follows"
                        : "Downloading media",
              });
            },
          });
        if (media.segment && media.seekableSection) {
          const sectionTemplate = outputTemplate.replace(
            ".%(ext)s",
            ".interval.%(ext)s",
          );
          this.setStatus("downloading", {
            phase: "Downloading selected video interval",
          });
          try {
            await downloadSource(sectionTemplate, media.segment);
            if (
              !filePath ||
              path.dirname(path.resolve(filePath)) !==
                path.resolve(this.workPath) ||
              !path.basename(filePath).startsWith(stem + ".interval.")
            )
              throw new Error("Unexpected video interval output.");
            const result = await this.validateOutput(filePath, {
              binPath: this.wrapper.binPath,
              signal: this.controller.signal,
              mergeAudio: media.mergeAudio,
            });
            const length = media.segment.end - media.segment.start;
            if (!result?.hasVideo || Math.abs(result.duration - length) > 0.15)
              throw new Error(
                "The source could not return the selected video interval.",
              );
            downloadedSection = true;
          } catch {
            this.controller.signal.throwIfAborted();
            filePath = undefined;
            this.tracks.clear();
            this.setStatus("downloading", {
              phase: "Downloading source for precise trimming",
            });
          }
        }
        if (!downloadedSection) await downloadSource(outputTemplate);
      }
      this.controller.signal.throwIfAborted();
      if (!filePath)
        throw new Error(
          "yt-dlp exited without reporting a completed output file.",
        );
      filePath = path.resolve(filePath);
      if (
        path.dirname(filePath) !== path.resolve(this.workPath) ||
        !path.basename(filePath).startsWith(stem)
      )
        throw new Error("yt-dlp reported an unexpected output location.");
      if (media.segment) {
        if (!downloadedSection) {
          const sourceStat = await fs.stat(filePath);
          if (!sourceStat.isFile() || !sourceStat.size)
            throw new Error("The source download is incomplete.");
          await fs.writeFile(
            cacheFile + ".tmp",
            JSON.stringify({
              key: sourceKey,
              name: path.basename(filePath),
              size: sourceStat.size,
            }),
          );
          await fs.rename(cacheFile + ".tmp", cacheFile);
        }
        this.setStatus("processing", {
          phase: "Processing video segment",
          stage: "trimming",
          stageProgress: 0,
          eta: null,
        });
        let subtitleSource;
        if (media.segmentSubtitle) {
          this.setStatus("processing", {
            stage: "subtitles",
            stageProgress: null,
          });
          try {
            subtitleSource = await this.downloadCaption(
              stem + ".captions",
              media.segmentSubtitle,
            );
          } catch (error) {
            this.controller.signal.throwIfAborted();
            if (!media.segmentSubtitle.allowWithoutCaptions) throw error;
            warning = "The clip was saved without the requested subtitle track.";
            captionRetryAt = error.retryAt || null;
          }
          this.setStatus("processing", { stage: "trimming", stageProgress: 0 });
        }
        filePath = await this.trimOutput({
          subtitleSource,
          source: filePath,
          segment: downloadedSection
            ? { start: 0, end: media.segment.end - media.segment.start }
            : media.segment,
          subtitleStart: media.segment.start,
          options: media.exportOptions,
          binPath: this.wrapper.binPath,
          signal: this.controller.signal,
          onProgress: (seconds) =>
            this.emit("progress", this.id, {
              speed: 0,
              eta: null,
              stage: "trimming",
              stageProgress: Math.min(
                99,
                Math.max(
                  0,
                  (seconds / (media.segment.end - media.segment.start)) * 100,
                ),
              ),
              phase:
                "Encoding segment: " +
                Math.min(
                  seconds,
                  media.segment.end - media.segment.start,
                ).toFixed(1) +
                " seconds",
            }),
        });
        this.controller.signal.throwIfAborted();
      }
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size === 0 || /\.(part|ytdl)$/.test(filePath))
        throw new Error("The media output is missing or incomplete.");
      if (media.type !== "subtitle") {
        this.setStatus("processing", {
          stage: "verifying",
          stageProgress: null,
        });
        await this.validateOutput(filePath, {
          binPath: this.wrapper.binPath,
          signal: this.controller.signal,
          audioOnly: media.audioOnly,
          mergeAudio: media.mergeAudio && media.exportOptions?.audio !== "none",
        });
      }
      this.controller.signal.throwIfAborted();
      const cleanName = sanitizeFilename(
        path
          .basename(filePath)
          .replace(` [${this.id}]${downloadedSection ? ".interval" : ""}`, ""),
      );
      // Standalone engines have no reservation callback; still publish with the
      // clean media name instead of an undefined filename.
      this.filename = cleanName;
      if (this.reserveTarget)
        Object.assign(this, await this.reserveTarget({ filename: cleanName }));
      const target = path.join(this.savePath, this.filename);
      this.setStatus("processing", {
        stage: "saving",
        stageProgress: null,
        phase: "Saving output",
      });
      await this.publish(filePath, target);
      await this.cleanup().catch(() => {});
      const published = await fs.stat(target);
      this.setStatus("completed", { stage: "completed", stageProgress: 100 });
      this.emit("complete", this.id, {
        filePath: target,
        filename: this.filename,
        totalSize: published.size,
        downloadedSize: published.size,
        approximateSize: false,
        warning,
        captionRetryAt,
      });
    } catch (error) {
      if (this.wantedState) {
        if (this.wantedState === "cancelled") await this.cleanup();
        this.setStatus(this.wantedState);
      } else {
        this.setStatus("failed", {
          error: error.message,
          captionRetryAt: error.retryAt || null,
        });
        this.emit("error", this.id, error);
      }
    }
  }
  async downloadCaption(stem, subtitle) {
    const sources = subtitle.sources || {};
    const wanted = subtitle.format === "srt" ? "srt" : "vtt";
    const source = [wanted, "vtt", "srt"].find((ext) => sources[ext]);
    const urls = [this.url, sources[source]];
    const signal = this.controller.signal;
    signal.throwIfAborted();
    checkCaptionCooldown(urls, this.captionRetryAt);
    let text;
    if (source) {
      // A current track URL avoids scraping the page again and converts locally.
      // The extractor is still useful after the analyzed URL expires.
      try {
        const raw = await fetchCaption(sources[source], {
          signal,
          timeout: this.timeout,
        });
        text = convertCaptions(raw, source, wanted);
      } catch (error) {
        signal.throwIfAborted();
        if (error.code === "CAPTION_RATE_LIMIT") {
          recordCaptionCooldown(urls, error);
          throw error;
        }
      }
    }
    if (text) {
      const target = path.join(
        this.workPath,
        `${stem}.${sanitizeFilename(subtitle.language || "subtitle")}.${wanted}`,
      );
      await fs.writeFile(target, text, "utf8");
      return target;
    }
    checkCaptionCooldown(urls);
    return this.wrapper.downloadSubtitles({
      url: this.url,
      ...subtitle,
      outputTemplate: path.join(
        this.workPath,
        stem.replaceAll("%", "%%") + ".%(ext)s",
      ),
      timeout: this.timeout / 1000,
      signal,
    }).catch((error) => {
      signal.throwIfAborted();
      if (!/\b(?:HTTP(?: Error)?\s+429|429 Too Many Requests)\b/i.test(error.message))
        throw error;
      const limited = captionRateLimit();
      recordCaptionCooldown(urls, limited);
      throw limited;
    });
  }
  async publish(source, target) {
    await fs.mkdir(this.savePath, { recursive: true });
    const handle = await fs.open(source, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await publishFile(source, target, this.id);
    await fs.rm(source, { force: true });
  }
  async cleanup() {
    // Remove this transfer's work folder and any legacy in-place fragments.
    if (this.workPath && this.workPath !== this.savePath)
      await fs
        .rm(this.workPath, { recursive: true, force: true })
        .catch(() => {});
    const names = await fs.readdir(this.savePath).catch(() => []);
    await Promise.all(
      names
        .filter(
          (name) =>
            name.includes(`[${this.id}]`) ||
            name.startsWith(`.getanny-media-${this.id}`),
        )
        .map((name) => fs.rm(path.join(this.savePath, name), { force: true })),
    );
  }
  async stop(status) {
    if (["completed", "failed", "cancelled"].includes(this.status))
      return false;
    this.wantedState = status;
    this.controller.abort();
    await this.task;
    return true;
  }
  pause() {
    return this.stop("paused");
  }
  cancel() {
    return this.stop("cancelled");
  }
}
module.exports = { MediaEngine, segmentStamp };
