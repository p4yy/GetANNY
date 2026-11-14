const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");

const MAX_RESPONSE_BYTES = 300 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_FILES = 500;

class PreviewService {
  constructor({
    userDataPath,
    binPath,
    nativeImage = null,
    getFileIcon = null,
  } = {}) {
    this.folder = path.join(userDataPath, "preview-cache");
    this.binPath = binPath;
    this.nativeImage = nativeImage;
    this.getFileIcon = getFileIcon;
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.children = new Set();
    this.generated = 0;
    this.closed = false;
  }

  async get(item) {
    if (this.closed || item.status !== "completed" || !item.filePath)
      return { url: null };
    const stat = await fs.stat(item.filePath).catch(() => null);
    if (!stat?.isFile()) return { url: null };
    const key = createHash("sha256")
      .update(`${item.filePath}\0${stat.size}\0${stat.mtimeMs}\0v3`)
      .digest("hex");
    const file = path.join(this.folder, `${key}.png`);
    if (this.pending.has(key)) return this.pending.get(key);
    const operation = this.enqueue(async () => {
      const cached = await this.read(file);
      if (cached) return { url: cached };
      await fs.mkdir(this.folder, { recursive: true });
      const temporary = path.join(this.folder, `${key}.${process.pid}.tmp.png`);
      try {
        const native =
          item.category === "Applications"
            ? await this.applicationIcon(item.filePath)
            : await this.nativePreview(item.filePath);
        if (native) await fs.writeFile(temporary, native);
        else if (!(await this.ffmpegPreview(item, temporary)))
          return { url: null };
        await fs.rename(temporary, file);
        this.generated++;
        if (this.generated % 25 === 0) await this.prune();
        return { url: await this.read(file) };
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(key);
    }
  }

  enqueue(task) {
    const result = this.queue.then(() =>
      this.closed ? { url: null } : task(),
    );
    this.queue = result.catch(() => ({ url: null }));
    return result.catch(() => ({ url: null }));
  }

  async read(file) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.size === 0 || stat.size > MAX_RESPONSE_BYTES)
      return null;
    const data = await fs.readFile(file);
    return `data:image/png;base64,${data.toString("base64")}`;
  }

  async nativePreview(filePath) {
    if (!this.nativeImage?.createThumbnailFromPath) return null;
    try {
      const image = await this.nativeImage.createThumbnailFromPath(filePath, {
        width: 160,
        height: 100,
      });
      if (!image || image.isEmpty()) return null;
      const data = image.toPNG();
      return data.length && data.length <= MAX_RESPONSE_BYTES ? data : null;
    } catch {
      return null;
    }
  }

  async applicationIcon(filePath) {
    try {
      let image;
      if (
        process.platform === "win32" &&
        [".msi", ".exe"].includes(path.extname(filePath).toLowerCase())
      ) {
        image = await this.installerIcon(filePath);
        // Read the product's embedded resources instead of a shell association
        // icon. Keep the neutral app glyph when no product icon is available.
        if (!image || image.isEmpty()) return null;
      } else image = await this.getFileIcon?.(filePath, { size: "large" });
      if (!image || image.isEmpty()) return null;
      const data = image
        .resize({ width: 96, height: 96, quality: "best" })
        .toPNG();
      return data.length && data.length <= MAX_RESPONSE_BYTES ? data : null;
    } catch {
      return null;
    }
  }

  async installerIcon(filePath) {
    if (!this.nativeImage?.createFromPath) return null;
    const temporary = path.join(
      this.folder,
      `app-${require("node:crypto").randomUUID()}${path.extname(filePath).toLowerCase() === ".exe" ? ".png" : ".ico"}`,
    );
    const script = path.join(
      __dirname.replace(/app\.asar([\\/])/, "app.asar.unpacked$1"),
      "ExtractInstallerIcon.ps1",
    );
    try {
      const success = await new Promise((resolve) => {
        const executable = path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        );
        const child = spawn(
          executable,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            "-Installer",
            filePath,
            "-Output",
            temporary,
          ],
          { windowsHide: true, stdio: "ignore" },
        );
        this.children.add(child);
        const timer = setTimeout(() => child.kill(), 10000);
        const finish = (ok) => {
          clearTimeout(timer);
          this.children.delete(child);
          resolve(ok);
        };
        child.once("error", () => finish(false));
        child.once("close", (code) => finish(code === 0));
      });
      if (!success) return null;
      const data = await fs.readFile(temporary);
      if (data[0] === 0x4d && data[1] === 0x5a) {
        await fs.rename(temporary, temporary + ".exe");
        try {
          return await this.getFileIcon(temporary + ".exe", { size: "large" });
        } finally {
          await fs.rm(temporary + ".exe", { force: true }).catch(() => {});
        }
      }
      return this.nativeImage.createFromPath(temporary);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async ffmpegPreview(item, output) {
    if (!["Images", "Video", "Audio"].includes(item.category)) return false;
    const executable = path.join(
      this.binPath || "",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
    if (item.category === "Video") args.push("-ss", "1");
    args.push(
      "-i",
      item.filePath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=160:100:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=160:100:(ow-iw)/2:(oh-ih)/2:color=0x171d24",
      "-q:v",
      "5",
      "-update",
      "1",
      output,
    );
    return new Promise((resolve) => {
      const child = spawn(executable, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      this.children.add(child);
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 10000);
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.once("error", () => finish(false));
      child.once("close", (code) => finish(code === 0));
      const finish = (success) => {
        clearTimeout(timer);
        this.children.delete(child);
        resolve(success);
      };
    });
  }

  async prune() {
    const names = (await fs.readdir(this.folder).catch(() => [])).filter(
      (name) => /^[a-f0-9]{64}\.(?:jpg|png)$/.test(name),
    );
    const files = await Promise.all(
      names.map(async (name) => {
        const file = path.join(this.folder, name);
        const stat = await fs.stat(file).catch(() => null);
        return stat ? { file, size: stat.size, mtime: stat.mtimeMs } : null;
      }),
    );
    const valid = files.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
    let total = valid.reduce((sum, file) => sum + file.size, 0);
    for (let index = MAX_CACHE_FILES; index < valid.length; index++) {
      await fs.rm(valid[index].file, { force: true }).catch(() => {});
      total -= valid[index].size;
    }
    for (const file of valid.slice(0, MAX_CACHE_FILES).reverse()) {
      if (total <= MAX_CACHE_BYTES) break;
      await fs.rm(file.file, { force: true }).catch(() => {});
      total -= file.size;
    }
  }

  async close() {
    this.closed = true;
    for (const child of this.children) child.kill();
    await this.queue;
  }
}

module.exports = { PreviewService };
