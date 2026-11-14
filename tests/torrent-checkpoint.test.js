const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { temporary } = require("./helpers");
const {
  TorrentCheckpoint,
  restoreTorrentCheckpoint,
} = require("../src/main/engine/torrent-checkpoint");
const { TorrentEngine } = require("../src/main/engine/TorrentEngine");

async function makeCheckpoint(t) {
  const folder = await temporary(t);
  const data = Buffer.alloc(3 * 16384, 0x31);
  data.name = "fixture.bin";
  const { default: createTorrent } = await import("create-torrent");
  const metadata = await new Promise((resolve, reject) =>
    createTorrent(
      data,
      { name: "fixture.bin", pieceLength: 16384, announce: [] },
      (error, torrent) => (error ? reject(error) : resolve(torrent)),
    ),
  );
  const file = path.join(folder, "fixture.bin");
  await fs.writeFile(file, data);
  const torrent = Object.assign(new EventEmitter(), {
    torrentFile: metadata,
    bitfield: { get: (index) => index === 0 },
  });
  const checkpoint = await TorrentCheckpoint.attach(torrent, folder);
  torrent.emit("verified", 1);
  torrent.emit("verified", 2);
  await checkpoint.close();
  return { folder, data, file, metadata };
}

test(
  "torrent restart gives WebTorrent the checked bitfield and publishes verified local data",
  { timeout: 12000 },
  async (t) => {
    let client;
    t.after(async () => {
      if (client && !client.destroyed)
        await new Promise((resolve) => client.destroy(resolve));
    });
    const fixture = await makeCheckpoint(t);
    const { default: WebTorrent } = await import("webtorrent");
    client = new WebTorrent({
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
    });
    const add = client.add.bind(client);
    let bits;
    client.add = (source, options) => {
      bits = Buffer.from(options.bitfield);
      return add(source, options);
    };
    const torrentFile = path.join(fixture.folder, "input.torrent");
    await fs.writeFile(torrentFile, fixture.metadata);
    const engine = new TorrentEngine({
      id: "checkpoint-fixture",
      url: torrentFile,
      torrentMetadataPath: torrentFile,
      tempPath: fixture.folder,
      savePath: await temporary(t),
      sharedTorrentClient: client,
    });
    let result;
    engine.on("error", (_id, error) => {
      throw error;
    });
    engine.on("complete", (_id, value) => {
      result = value;
    });
    await engine.start();
    assert.equal(engine.status, "completed");
    assert.deepEqual(bits, Buffer.from([0xe0]));
    assert.deepEqual(
      await fs.readFile(result.filePath),
      Buffer.from(fixture.data),
    );
  },
);

test("a bad sampled piece rejects a checkpoint even when file signatures match", async (t) => {
  const fixture = await makeCheckpoint(t);
  const valid = await restoreTorrentCheckpoint(
    fixture.folder,
    fixture.metadata,
  );
  assert.deepEqual(valid.bitfield, Buffer.from([0xe0]));
  const handle = await fs.open(fixture.file, "r+");
  await handle.write(Buffer.from([0x00]), 0, 1, 16384);
  await handle.close();
  const stateFile = path.join(fixture.folder, ".getanny-torrent-state.json");
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  const stat = await fs.stat(fixture.file);
  state.files[0] = { size: stat.size, mtimeMs: stat.mtimeMs };
  await fs.writeFile(stateFile, JSON.stringify(state));
  const changed = await restoreTorrentCheckpoint(
    fixture.folder,
    fixture.metadata,
  );
  assert.equal(changed.bitfield, undefined);
});
