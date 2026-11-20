// Verify the exact bytes of a draft release before making it public.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { hashFile } = require("./checksums");
const { installerName, updateMetadataName, updateMetadata } = require("./write-update-metadata");

async function verifyReleaseAssets(release, directory, { tag, source, allowDraftPlaceholder = false }) {
  const placeholder = allowDraftPlaceholder &&
    release.draft === true && /^untagged-[0-9a-f]+$/.test(release.tag_name);
  if (!placeholder) assert.equal(release.tag_name, tag, "Wrong release tag");
  assert.equal(release.target_commitish, source, "Wrong release source");
  assert.equal(
    release.draft,
    true,
    "Release must remain a draft until verified",
  );
  assert.equal(
    release.prerelease,
    false,
    "The official release must not be marked as a prerelease",
  );
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  assert.ok(names.length > 0, "Release directory is empty");
  assert.equal(
    await fs.readFile(path.join(directory, updateMetadataName), "utf8"),
    await updateMetadata(directory, tag.slice(1)),
    "Update metadata must match the release version and installer bytes",
  );
  assert.equal(
    release.assets.length,
    names.length,
    "Release asset count differs",
  );
  for (const name of names) {
    const matches = release.assets.filter(
      (asset) => asset.label === name || asset.name === name,
    );
    assert.equal(
      matches.length,
      1,
      `Missing or duplicate uploaded asset: ${name}`,
    );
    const asset = matches[0];
    if (name === installerName || name === updateMetadataName)
      assert.equal(asset.name, name, `GitHub changed the public update path: ${name}`);
    assert.equal(asset.state, "uploaded", `Asset not uploaded: ${name}`);
    assert.equal(
      asset.digest,
      `sha256:${await hashFile(path.join(directory, name))}`,
      `Asset digest mismatch: ${name}`,
    );
  }
  return names.length;
}

if (require.main === module) {
  (async () => {
    const [file, dir, tag, source, option] = process.argv.slice(2);
    assert.ok(
      file && dir && tag && source,
      "Usage: verify-release-assets <release.json> <dir> <tag> <source>",
    );
    const release = JSON.parse(await fs.readFile(file, "utf8"));
    const count = await verifyReleaseAssets(release, dir, {
      tag, source, allowDraftPlaceholder: option === "--allow-draft-placeholder",
    });
    console.log(
      `Verified ${count} uploaded draft assets against local SHA-256 digests.`,
    );
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { verifyReleaseAssets };
