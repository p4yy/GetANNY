const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { once } = require("node:events");
const { temporary, waitFor } = require("./helpers");
const { FtpDownloader } = require("../src/main/engine/FtpDownloader");
const {
  validateDownloadUrl,
  validateUrl,
} = require("../src/main/engine/utils");

async function ftpFixture(t, bytes) {
  const servers = new Set();
  const sockets = new Set();
  const starts = [];
  const state = { modified: "20261113020000" };
  const listen = async (server) => {
    servers.add(server);
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address().port;
  };
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [...servers].map(
        (server) => new Promise((resolve) => server.close(resolve)),
      ),
    );
  });
  const server = net.createServer((control) => {
    control.setEncoding("utf8");
    let pending = "",
      offset = 0,
      dataSocket,
      ready;
    const reply = (line) => control.write(line + "\r\n");
    reply("220 GetANNY FTP fixture");
    control.on("close", () => dataSocket?.destroy());
    control.on("data", (chunk) => {
      pending += chunk;
      while (pending.includes("\r\n")) {
        const end = pending.indexOf("\r\n");
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        command(line).catch((error) => control.destroy(error));
      }
    });
    async function command(line) {
      const [verb, value] = line.split(" ", 2);
      switch (verb) {
        case "USER":
          return reply("230 Signed in");
        case "FEAT":
          return reply(
            "211-Features\r\n REST STREAM\r\n MDTM\r\n SIZE\r\n211 End",
          );
        case "SIZE":
          return reply("213 " + bytes.length);
        case "MDTM":
          return reply("213 " + state.modified);
        case "REST":
          offset = Number(value);
          return reply("350 Restart accepted");
        case "EPSV": {
          const passive = net.createServer();
          ready = once(passive, "connection").then(([socket]) => {
            dataSocket = socket;
            passive.close();
            return socket;
          });
          const port = await listen(passive);
          return reply("229 Entering Extended Passive Mode (|||" + port + "|)");
        }
        case "RETR": {
          const socket = await ready;
          starts.push(offset);
          reply("150 Sending");
          let cursor = offset;
          const send = () => {
            if (socket.destroyed) return;
            if (cursor === bytes.length) {
              socket.end();
              reply("226 Complete");
              return;
            }
            const end = Math.min(bytes.length, cursor + 32768);
            socket.write(bytes.subarray(cursor, end));
            cursor = end;
            setTimeout(send, 2).unref();
          };
          send();
          return;
        }
        default:
          return reply("200 OK");
      }
    }
  });
  const port = await listen(server);
  return { url: "ftp://127.0.0.1:" + port + "/example.bin", starts, state };
}

test("FTP scope is restricted to file downloads and excludes embedded credentials", () => {
  assert.equal(validateDownloadUrl("ftp://host/file"), "ftp://host/file");
  assert.throws(() => validateUrl("ftp://host/file"));
  assert.throws(
    () => validateDownloadUrl("ftp://a:b@host/file"),
    /credentials/,
  );
});

test(
  "FTP pauses and resumes concurrent REST segments with exact bytes",
  { timeout: 30000 },
  async (t) => {
    const size = 9 * 1024 * 1024;
    const bytes = Buffer.alloc(size);
    for (let index = 0; index < size; index++) bytes[index] = index % 251;
    const ftp = await ftpFixture(t, bytes);
    const folder = await temporary(t);
    const options = {
      id: "ftp",
      url: ftp.url,
      savePath: folder,
      connections: 3,
    };
    const first = new FtpDownloader(options);
    first.on("error", (_id, error) => assert.fail(error));
    const task = first.start();
    await waitFor(() => ftp.starts.length === 3 && first.downloadedSize > 0);
    await first.pause();
    await task;
    assert.equal(first.status, "paused");
    const second = new FtpDownloader(options);
    second.on("error", (_id, error) => assert.fail(error));
    await second.start();
    assert.equal(second.status, "completed");
    assert.equal(second.segmentCount, 3);
    assert.ok(ftp.starts.slice(3).some((offset) => offset % (size / 3) !== 0));
    assert.deepEqual(
      await fs.readFile(path.join(folder, "example.bin")),
      bytes,
    );
  },
);
