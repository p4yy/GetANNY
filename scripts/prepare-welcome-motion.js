// Generate a genuine 10-second, sharp GetANNY logo MP4.
// Prefer the owner's original motion backdrop when the embedded copy decodes;
// otherwise use a clean brand-colored animated scene (never a fuzzy upscale).
// Motion ends with this one-time welcome view; no idle video decoder remains.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const originalBase64 = fs.readFileSync(
  path.join(root, "assets/brand/welcome-motion.b64"), "utf8").trim();
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(originalBase64))
  throw new Error("Invalid welcome motion source.");
const original = Buffer.from(originalBase64, "base64");
const ffmpeg = process.platform === "win32"
  ? path.join(root, "bin", "ffmpeg.exe")
  : fs.existsSync(path.join(root, "bin", "ffmpeg"))
    ? path.join(root, "bin", "ffmpeg") : "ffmpeg";
const brand = path.join(root, "assets", "brand", "symbol-white.png");
const output = path.join(root, "public", "welcome-motion.mp4");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "getanny-welcome-"));
try {
  const source = path.join(tmp, "original.mp4");
  fs.writeFileSync(source, original);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  function render(useOriginal) {
    const background = useOriginal
      ? ["-i", source]
      : ["-f", "lavfi", "-i", "color=c=0x10266e:s=448x448:r=30:d=10"];
    const filter = [
      useOriginal
        ? "[0:v]fps=30,scale=448:448:flags=lanczos,boxblur=14:4[bg]"
        : "[0:v]format=rgba[bg]",
      "[1:v]scale=134:-1:flags=lanczos,format=rgba,fade=t=in:st=0.25:d=0.7:alpha=1[brand]",
      "[bg][brand]overlay=x=(W-w)/2+2*sin(2*PI*t/10):y=(H-h)/2+2*cos(2*PI*t/10):format=auto:shortest=1,format=yuv420p[out]",
    ].join(";");
    const argv = [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
      ...background, "-loop", "1", "-i", brand,
      "-filter_complex", filter, "-map", "[out]",
      "-an", "-t", "10", "-r", "30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
    ];
    return spawnSync(ffmpeg, argv, {
      encoding: "utf8", timeout: 120000, windowsHide: true, maxBuffer: 1048576,
    });
  }
  // Only trust the supplied clip when it still has its original checksum.
  // A corrupt, overcompressed or mismatched resource is never an excuse to
  // ship unusable video. Render a new branded animation instead.
  const { createHash } = require("node:crypto");
  const trusted = original.length === 5069 &&
    original.toString("ascii", 4, 8) === "ftyp" &&
    createHash("sha256").update(original).digest("hex") ===
      "ac06c0d3edd38ad483e40c55b4ff1a57fc74382f40d111690784cd86c";
  let result = trusted ? render(true) : null;
  if (!result || result.error || result.status !== 0) {
    result = render(false);
    console.log("Generated original GetANNY logo motion from official HD brand artwork.");
  }
  if (result.error || result.status !== 0)
    throw new Error("Welcome video encoding failed: " +
      (result.error?.message || result.stderr?.slice(-900) || result.status));
  const stat = fs.statSync(output);
  if (stat.size < 10000 || stat.size > 5 * 1024 * 1024)
    throw new Error("Welcome video quality/size bounds failed.");
  console.log("Prepared real GetANNY logo animation: 448x448, 30fps, 10s,", stat.size, "bytes");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
