const { ChunkDownloader } = require("./ChunkDownloader");
const { FtpDownloader } = require("./FtpDownloader");
const { BrowserPayloadDownloader } = require("./BrowserPayloadDownloader");
const { MegaDownloader, isMegaShare } = require("./MegaDownloader");
const { TorrentEngine } = require("./TorrentEngine");
const { serializeError, deserializeError } = require("./worker-errors");

const kind = process.argv[2];
const jobs = new Map();
const reservations = new Map();
let clientPromise;
let client;
let globalSpeedLimit;
let closing = false;

const send = (message) => {
  if (process.connected) process.send(message, () => {});
};
function sharedTorrentClient() {
  if (!clientPromise) {
    clientPromise = import("webtorrent")
      .then(({ default: WebTorrent }) => {
        client = new WebTorrent({
          maxConns: 200,
          utp: true,
          downloadLimit: globalSpeedLimit || -1,
          uploadLimit: 512 * 1024,
        });
        return client;
      })
      .catch((error) => {
        clientPromise = undefined;
        throw error;
      });
  }
  return clientPromise;
}

function reserveTarget(id, info) {
  return new Promise((resolve, reject) => {
    reservations.set(id, { resolve, reject });
    send({ type: "reserve", id, info: { filename: info.filename } });
  });
}

async function start({ id, options, torrent }) {
  try {
    if (kind === "torrent") globalSpeedLimit ??= torrent.globalSpeedLimit;
    const engine =
      kind === "torrent"
        ? new TorrentEngine({
            ...options,
            getSharedTorrentClient: torrent.shared
              ? sharedTorrentClient
              : undefined,
            getTrackers: () => torrent.trackers,
          })
        : new (options.browserPayloadPath
            ? BrowserPayloadDownloader
            : /^ftps?:/i.test(options.url)
              ? FtpDownloader
              : isMegaShare(options.url)
                ? MegaDownloader
                : ChunkDownloader)({
            ...options,
            reserveTarget: (info) => reserveTarget(id, info),
          });
    jobs.set(id, engine);
    for (const name of ["progress", "status", "complete"])
      engine.on(name, (_jobId, ...args) =>
        send({ type: "event", id, name, args }),
      );
    engine.on("error", (_jobId, error) =>
      send({ type: "event", id, name: "error", error: serializeError(error) }),
    );
    await engine.start();
    send({ type: "settled", id });
  } catch (error) {
    send({ type: "settled", id, error: serializeError(error) });
  } finally {
    jobs.delete(id);
    reservations.delete(id);
  }
}

async function control({ id, request, command, value }) {
  const engine = jobs.get(id);
  const result = { type: "control-result", id, request };
  try {
    if (!engine) result.value = false;
    else if (command === "limit") {
      if (engine.limiter) engine.limiter.setLimit(value);
      else {
        engine.speedLimit = value;
        if (engine.clientOwned) engine.client?.throttleDownload(value || -1);
      }
      result.value = true;
    } else if (command === "finishSeeding") {
      result.value = Boolean(engine.finishSeeding);
      engine.finishSeeding?.();
    } else if (command === "addPeer") {
      const match =
        typeof value === "string" && /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value);
      if (kind !== "torrent" || !match || Number(match[1]) > 65535)
        throw new Error("Only a valid loopback TCP peer can be added.");
      if (!engine.torrent) result.value = false;
      else {
        engine.torrent.addPeer(value);
        result.value = true;
      }
    } else if (["pause", "cancel", "resume", "shutdown"].includes(command)) {
      const action =
        command === "shutdown" && !engine.shutdown ? "pause" : command;
      result.value = await engine[action]?.();
    } else throw new Error("Unknown transfer process command.");
    result.keepTorrentPaused = engine?.keepTorrentPaused === true;
  } catch (error) {
    result.error = serializeError(error);
  }
  send(result);
}

process.on("message", (message) => {
  if (closing) return;
  if (message.type === "start") void start(message);
  else if (message.type === "control") void control(message);
  else if (message.type === "throttle") {
    globalSpeedLimit = message.limit;
    client?.throttleDownload(globalSpeedLimit || -1);
  } else if (message.type === "reserved") {
    const reservation = reservations.get(message.id);
    reservations.delete(message.id);
    if (message.error) reservation?.reject(deserializeError(message.error));
    else reservation?.resolve(message.value);
  }
});

process.once("disconnect", async () => {
  closing = true;
  for (const reservation of reservations.values())
    reservation.reject(new Error("The transfer supervisor disconnected."));
  await Promise.allSettled(
    [...jobs.values()].map((engine) => engine.shutdown?.() ?? engine.pause()),
  );
  await clientPromise?.catch(() => {});
  if (client && !client.destroyed)
    await new Promise((resolve) => client.destroy(resolve));
  process.exit(0);
});
