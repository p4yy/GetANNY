const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { hashFile } = require("./checksums");

const installerName = "GetANNY.Setup.exe";
const updateMetadataName = "latest.yml";

async function updateMetadata(directory, version) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const installer = path.join(directory, installerName);
  const { size } = await fs.stat(installer);
  assert.ok(size > 0, "The installer is empty");
  const sha512 = await hashFile(installer, "sha512", "base64");
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    "",
  ].join("\n");
}

if (require.main === module) {
  const directory = process.argv[2] || "release-assets";
  const { version } = require("../package.json");
  updateMetadata(directory, version)
    .then((contents) => fs.writeFile(path.join(directory, updateMetadataName), contents))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { installerName, updateMetadataName, updateMetadata };
