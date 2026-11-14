const fs = require("node:fs");
const path = require("node:path");
const { isSensitiveHeader, redactLogText } = require("./sensitive-headers");
class Logger {
  constructor(scope = "app") {
    this.scope = scope;
  }
  write(level, args) {
    const formatted = args.map((value) => {
      if (value instanceof Error) return redactLogText(value.stack);
      if (typeof value === "string") return redactLogText(value);
      return JSON.stringify(value, (key, entry) =>
        isSensitiveHeader(key)
          ? "[redacted]"
          : typeof entry === "string"
            ? redactLogText(entry)
            : entry,
      );
    });
    const line = `[${new Date().toISOString()}] [${level}] [${this.scope}] ${formatted.join(" ")}\n`;
    (level === "ERROR"
      ? console.error
      : level === "WARN"
        ? console.warn
        : console.log)(line.trimEnd());
    try {
      const base = process.env.GETANNY_LOG_DIR || require("node:os").tmpdir();
      fs.appendFileSync(path.join(base, "getanny.log"), line);
    } catch {}
  }
  info(...a) {
    this.write("INFO", a);
  }
  warn(...a) {
    this.write("WARN", a);
  }
  error(...a) {
    this.write("ERROR", a);
  }
  debug(...a) {
    if (process.env.GETANNY_DEBUG) this.write("DEBUG", a);
  }
}
module.exports = { Logger };
