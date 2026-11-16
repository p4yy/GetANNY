"use strict";

// Local-only wrapper build. It never reads or writes dist/, release metadata,
// GitHub, signing credentials, or the currently installed Setup.exe.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..", "..");
const shell = path.join(root, "installer", "publish", "GetANNY.Setup.exe");
const engine = path.join(root, "installer", "artifacts", "raw", "GetANNY Setup.exe");
const outputDir = path.join(root, "installer", "artifacts");
const output = path.join(outputDir, "GetANNY Setup - Local Candidate.exe");
const uninstaller = path.join(outputDir, "GetANNY Uninstall.exe");
const reportPath = path.join(outputDir, "local-candidate-report.json");
const magic = Buffer.from("GETANNY-NSIS-V1\0", "ascii");
const trailerLength = 64;

function fail(message) {
  console.error(`wrap-installer-candidate: ${message}`);
  process.exitCode = 1;
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest()));
  });
}

function appendFile(outputStream, file) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(file);
    input.on("error", reject);
    input.on("end", resolve);
    input.pipe(outputStream, { end: false });
  });
}

async function main() {
  for (const required of [shell, engine]) {
    if (!fs.existsSync(required)) throw new Error(`Missing build input: ${required}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const engineHash = await sha256(engine);
  const engineBytes = fs.statSync(engine).size;
  const trailer = Buffer.alloc(trailerLength);
  engineHash.copy(trailer, 0);
  trailer.writeBigUInt64LE(BigInt(engineBytes), 32);
  magic.copy(trailer, 48);

  const temporary = output + ".building";
  try { fs.rmSync(temporary, { force: true }); } catch {}
  const outputStream = fs.createWriteStream(temporary, { flags: "w" });
  const failed = new Promise((_, reject) => outputStream.once("error", reject));
  try {
    await Promise.race([appendFile(outputStream, shell), failed]);
    await Promise.race([appendFile(outputStream, engine), failed]);
    outputStream.end(trailer);
    await Promise.race([
      new Promise((resolve, reject) => {
        outputStream.once("finish", resolve);
        outputStream.once("error", reject);
      }),
      failed,
    ]);
    const result = fs.openSync(temporary, "r");
    try {
      const actual = Buffer.alloc(trailerLength);
      fs.readSync(result, actual, 0, trailerLength, fs.fstatSync(result).size - trailerLength);
      if (!actual.equals(trailer)) throw new Error("Wrapper trailer self-check failed.");
    } finally {
      fs.closeSync(result);
    }
    fs.rmSync(output, { force: true });
    fs.renameSync(temporary, output);
    fs.copyFileSync(shell, uninstaller);
  } catch (error) {
    outputStream.destroy();
    fs.rmSync(temporary, { force: true });
    throw error;
  }

  const shellBytes = fs.statSync(shell).size;
  const outputBytes = fs.statSync(output).size;
  const report = {
    builtAt: new Date().toISOString(),
    localOnly: true,
    signed: false,
    setup: path.relative(root, output),
    uninstallerShell: path.relative(root, uninstaller),
    shellBytes,
    engineBytes,
    outputBytes,
    engineSha256: engineHash.toString("hex"),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Created local candidate: ${output}`);
  console.log(`WPF shell ${shellBytes} B + NSIS engine ${engineBytes} B; SHA-256 ${report.engineSha256}`);
  console.log(`Uninstaller shell: ${uninstaller}`);
  console.log("Candidate is unsigned and was not copied to dist/ or published.");
}

main().catch(fail);
