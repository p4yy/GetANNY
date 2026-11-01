const fs = require("node:fs");
const path = require("node:path");
class Logger {
  constructor(scope = "app") {
    this.scope = scope;
  }
  write(level, args) {
    const redact = (value) =>
      String(value).replace(
        /((?:cookie|set-cookie|session|authorization|credential)[\w-]*\s*[:=]\s*)([^\s,;]+)/gi,
        "$1[redacted]",
      );
    const line = `[${new Date().toISOString()}] [${level}] [${this.scope}] ${args.map((x) => (x instanceof Error ? redact(x.stack) : typeof x === "string" ? redact(x) : redact(JSON.stringify(x)))).join(" ")}\n`;
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
