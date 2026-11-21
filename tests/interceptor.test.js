const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({
  URL,
  crypto: require("node:crypto"),
  navigator: { userAgent: "Browser Test" },
});
for (const script of ["download-preferences.js", "download-interceptor.js"])
  vm.runInContext(
    fs.readFileSync(require.resolve(`../src/extension/${script}`), "utf8"),
    context,
  );
const Interceptor = context.GetANNYDownloadInterceptor;

function fixture(options = {}) {
  const calls = [];
  const record = (name, value) => calls.push({ name, value });
  const api = {
    runtime: { id: "getanny-extension" },
    storage: {
      local: {
        get: async () => ({
          "getannyExtensionEnabled": options.extensionEnabled,
          "getannyAutomaticHandoff": options.automatic,
          "getanny:downloads:keep:example.test": options.keepInBrowser,
          "getanny:downloads:cookies:cdn.example.test": options.includeSiteCookies,
        }),
      },
      ...(options.session ? { session: options.session } : {}),
    },
    cookies: {
      getAll: async (query) => {
        record("cookies", query);
        if (options.cookies) return options.cookies(query);
        return [{ name: "session", value: "abc" }];
      },
      ...(options.partitionKey || options.partitionKeyError
        ? {
            getPartitionKey: async (details) => {
              record("partition-key", details);
              if (options.partitionKeyError)
                throw new Error("partition lookup unavailable");
              return options.partitionKey;
            },
          }
        : {}),
    },
    downloads: {
      onCreated: { addListener() {}, removeListener() {} },
      search: async ({ id }) =>
        options.search
          ? options.search(id)
          : [{ state: "in_progress", paused: true }],
      pause: async (id) => {
        record("pause", id);
        if (options.pauseError) throw new Error("cannot pause");
      },
      resume: async (id) => record("resume", id),
      cancel: async (id) => {
        record("cancel", id);
        if (options.cancelError && !options.cancelRecovered) {
          options.cancelRecovered = true;
          throw new Error("cannot cancel");
        }
      },
      erase: async (query) => record("erase", query),
    },
  };
  let handler =
    options.request || (async () => ({ action: "queued", id: "desktop-id" }));
  const errors = [];
  const interceptor = new Interceptor({
    api,
    request: (message) => {
      record("request", message);
      return handler(message);
    },
    onError: (error) => errors.push(error.message),
  });
  return {
    api,
    calls,
    errors,
    interceptor,
    setRequest: (next) => (handler = next),
  };
}

const item = (id, filename = "file.bin") => ({
  id,
  url: `https://example.test/${filename}`,
  finalUrl: `https://cdn.example.test/${filename}`,
  filename: `C:\\Users\\Test\\Downloads\\${filename}`,
  referrer: "https://example.test/page",
  mime: "application/octet-stream",
  state: "in_progress",
});

test("master OFF leaves native browser downloads completely untouched", async () => {
  const f = fixture({ extensionEnabled: false });
  await f.interceptor.created(item(1, "movie.mp4"));
  assert.equal(f.calls.some((call) => ["request", "pause", "cancel", "erase"].includes(call.name)), false);
});

test("ordinary browser handoff covers documents, archives, images, media and unknown/large files", async () => {
  for (const [index, name] of [
    "report.pdf",
    "archive.zip",
    "photo.jpg",
    "movie.mp4",
    "document.docx",
    "unknown.largefile",
  ].entries()) {
    const f = fixture({ includeSiteCookies: true });
    await f.interceptor.created({
      ...item(index + 1, name),
      totalBytes: Number.MAX_SAFE_INTEGER,
    });
    const request = f.calls.find((call) => call.name === "request").value;
    assert.equal(request.url, `https://cdn.example.test/${name}`);
    assert.equal(request.filename, name);
    assert.equal(request.kind, "file");
    assert.equal(request.intercepted, true);
    assert.equal(request.headers.Cookie, "session=abc");
    assert.equal(request.includeSiteCookies, true);
    assert.equal(request.headers.Referer, "https://example.test/page");
    assert.equal(request.headers["User-Agent"], "Browser Test");
    assert.deepEqual(
      f.calls
        .filter((call) => ["pause", "cancel", "erase"].includes(call.name))
        .map((call) => call.name),
      ["pause", "cancel", "erase"],
    );
    assert.equal(
      f.calls.some((call) => call.name === "resume"),
      false,
    );
  }
});

test("definitive desktop rejection resumes the paused native transfer", async () => {
  const failure = new Error("rejected");
  failure.definitive = true;
  const f = fixture({
    request: async () => {
      throw failure;
    },
  });
  await f.interceptor.created(item(10));
  assert.deepEqual(
    f.calls.filter((call) => call.name === "resume").map((call) => call.value),
    [10],
  );
  assert.equal(f.interceptor.entries.size, 0);
});

test("an unpausable short download stays native and is never sent to the desktop", async () => {
  const f = fixture({ pauseError: true });
  await f.interceptor.created(item(11));
  assert.equal(
    f.calls.some((call) => call.name === "request"),
    false,
  );
  assert.equal(
    f.calls.some((call) => call.name === "cancel"),
    false,
  );
  assert.match(f.errors[0], /left this download in the browser/);
});

test("ambiguous disconnection remains paused and reconciles without duplication", async () => {
  const failure = new Error("socket closed");
  failure.ambiguous = true;
  const f = fixture({
    request: async () => {
      throw failure;
    },
  });
  await f.interceptor.created(item(12));
  assert.equal(
    f.calls.some((call) => call.name === "resume"),
    false,
  );
  assert.equal(f.interceptor.entry(12).stage, "reconcile");
  f.setRequest(async (message) => {
    assert.equal(message.type, "download-status");
    return { action: "queued", id: "persisted" };
  });
  await f.interceptor.reconnect();
  assert.equal(
    f.calls.some((call) => call.name === "cancel" && call.value === 12),
    true,
  );
  assert.equal(
    f.calls.some((call) => call.name === "resume"),
    false,
  );
});

test("missing ambiguous requests resume on reconnect; reviews remain paused on disconnect", async () => {
  const f = fixture({
    request: async () => ({ action: "review", pendingId: "review" }),
  });
  await f.interceptor.created(item(13));
  await f.interceptor.disconnected();
  assert.equal(
    f.calls.some((call) => call.name === "resume"),
    false,
  );
  f.setRequest(async () => ({ action: "missing" }));
  await f.interceptor.reconnect();
  assert.deepEqual(
    f.calls.filter((call) => call.name === "resume").map((call) => call.value),
    [13],
  );
});

test("native cleanup failure never resumes an accepted desktop transfer and can be retried", async () => {
  const f = fixture({ cancelError: true });
  await f.interceptor.created(item(14));
  assert.equal(
    f.calls.some((call) => call.name === "resume"),
    false,
  );
  assert.equal(f.interceptor.entry(14).stage, "cleanup");
  f.setRequest(async () => ({ action: "queued", id: "desktop-id" }));
  await f.interceptor.reconnect();
  assert.equal(
    f.calls.filter((call) => call.name === "cancel" && call.value === 14)
      .length,
    2,
  );
  assert.equal(f.interceptor.entries.size, 0);
});

test("private, non-HTTP and extension-owned downloads remain native", async () => {
  const f = fixture();
  await f.interceptor.created({ ...item(15), incognito: true });
  await f.interceptor.created({
    ...item(16),
    byExtensionId: "getanny-extension",
  });
  await f.interceptor.created({
    ...item(17),
    url: "blob:https://example.test/id",
    finalUrl: "",
  });
  assert.equal(f.calls.length, 0);
});

test("review commands are idempotent and return dismissed items to the browser", async () => {
  const f = fixture({ request: async () => ({ action: "review" }) });
  await f.interceptor.created(item(18));
  const transferId = f.interceptor.entry(18).transferId;
  await f.interceptor.command({ action: "resume", transferId });
  assert.deepEqual(
    f.calls.filter((call) => call.name === "resume").map((call) => call.value),
    [18],
  );
  const missing = await f.interceptor.command({
    action: "cancel",
    transferId,
  });
  assert.equal(missing.missing, true);
});

test("browser download IDs reused across profiles or restarts get distinct handoff identities", async () => {
  const first = fixture();
  const second = fixture();
  await first.interceptor.created(item(1));
  await second.interceptor.created(item(1));
  const a = first.calls.find((call) => call.name === "request").value
    .transferId;
  const b = second.calls.find((call) => call.name === "request").value
    .transferId;
  assert.notEqual(a, b);
  assert.notEqual(a, "1");
});

test("cookie lookup is opt-in per download host and uses the download's browser cookie store", async () => {
  const f = fixture({ includeSiteCookies: true });
  await f.interceptor.created({
    ...item(21),
    cookieStoreId: "firefox-container-2",
  });
  const query = f.calls.find((call) => call.name === "cookies").value;
  assert.equal(query.storeId, "firefox-container-2");
  assert.equal(query.url, "https://cdn.example.test/file.bin");
  const optedOut = fixture({ includeSiteCookies: false });
  await optedOut.interceptor.created(item(22));
  const request = optedOut.calls.find((call) => call.name === "request").value;
  assert.equal(request.headers.Cookie, undefined);
  assert.equal(request.includeSiteCookies, false);
  assert.equal(
    optedOut.calls.some((call) => call.name === "cookies"),
    false,
  );
});

test("CHIPS cookies are fetched from the initiating frame partition and merged with ordinary cookies", async () => {
  const partitionKey = {
    topLevelSite: "https://example.test",
    hasCrossSiteAncestor: false,
  };
  const f = fixture({
    includeSiteCookies: true,
    partitionKey: { partitionKey },
    cookies: async (query) =>
      query.partitionKey
        ? [{
            name: "chip",
            value: "partitioned",
            domain: "cdn.example.test",
            path: "/",
            partitionKey,
          }]
        : [{
            name: "session",
            value: "ordinary",
            domain: "cdn.example.test",
            path: "/",
          }],
  });
  await f.interceptor.created({ ...item(23), tabId: 41 });
  const partitionCall = f.calls.find((call) => call.name === "partition-key").value;
  assert.equal(partitionCall.tabId, 41);
  assert.equal(partitionCall.frameId, 0);
  const cookieQueries = f.calls
    .filter((call) => call.name === "cookies")
    .map((call) => call.value);
  assert.equal(cookieQueries.length, 2);
  assert.equal(cookieQueries[1].partitionKey.topLevelSite, "https://example.test");
  assert.equal(
    f.calls.find((call) => call.name === "request").value.headers.Cookie,
    "session=ordinary; chip=partitioned",
  );
});

test("an unavailable CHIPS frame key falls back to ordinary cookies without blocking handoff", async () => {
  const f = fixture({
    includeSiteCookies: true,
    partitionKeyError: true,
  });
  await f.interceptor.created({ ...item(24), tabId: 42 });
  assert.equal(
    f.calls.find((call) => call.name === "request").value.headers.Cookie,
    "session=abc",
  );
  assert.equal(f.errors.length, 0);
});

test("manual-only mode and a source-site exception leave browser downloads untouched", async () => {
  for (const options of [{ automatic: false }, { keepInBrowser: true }]) {
    const f = fixture(options);
    await f.interceptor.created(item(24));
    assert.deepEqual(f.calls, []);
  }
});

function sessionStorage(initial = []) {
  let data = { getannyHandoffs: structuredClone(initial) };
  return {
    get: async () => structuredClone(data),
    set: async (value) => {
      data = structuredClone(value);
    },
  };
}

test("worker restart restores a paused review and can return it to the browser", async () => {
  const session = sessionStorage();
  const first = fixture({
    session,
    request: async () => ({ action: "review" }),
  });
  first.interceptor.start();
  await first.interceptor.created(item(31));
  const id = first.interceptor.entry(31).transferId;
  const next = fixture({ session });
  next.interceptor.start();
  await next.interceptor.ready;
  assert.equal(next.interceptor.entries.get(id).stage, "review");
  assert.equal(
    (await next.interceptor.command({ action: "resume", transferId: id }))
      .success,
    true,
  );
  assert.equal(
    next.calls.some((call) => call.name === "resume" && call.value === 31),
    true,
  );
  assert.equal((await session.get()).getannyHandoffs.length, 0);
});

test("worker restart reconciles an acknowledged desktop transfer without resuming the browser copy", async () => {
  const session = sessionStorage();
  const error = new Error("connection lost");
  error.ambiguous = true;
  const first = fixture({
    session,
    request: async () => {
      throw error;
    },
  });
  first.interceptor.start();
  await first.interceptor.created(item(32));
  const id = first.interceptor.entry(32).transferId;
  const next = fixture({
    session,
    request: async () => ({ action: "queued" }),
  });
  next.interceptor.start();
  await next.interceptor.reconnect();
  assert.equal(
    next.calls.some((call) => call.name === "cancel" && call.value === 32),
    true,
  );
  assert.equal(
    next.calls.some((call) => call.name === "resume"),
    false,
  );
  assert.equal(next.interceptor.entries.has(id), false);
});

test("worker restart resumes an unsent download paused immediately before suspension", async () => {
  const session = sessionStorage([
    {
      downloadId: 33,
      transferId: "handoff",
      paused: false,
      stage: "preparing",
      requestStarted: false,
    },
  ]);
  const next = fixture({
    session,
    search: () => [{ state: "in_progress", paused: true }],
  });
  next.interceptor.start();
  await next.interceptor.ready;
  assert.equal(
    next.calls.some((call) => call.name === "resume" && call.value === 33),
    true,
  );
  assert.equal((await session.get()).getannyHandoffs.length, 0);
});

test("disconnect during metadata gathering cannot start a second desktop copy", async () => {
  let unblock;
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    includeSiteCookies: true,
    cookies: () => {
      entered();
      return new Promise((resolve) => {
        unblock = resolve;
      });
    },
  });
  const handoff = f.interceptor.created(item(34));
  await waiting;
  await f.interceptor.disconnected();
  unblock([]);
  await handoff;
  assert.equal(
    f.calls.some((call) => call.name === "request"),
    false,
  );
  assert.equal(f.calls.filter((call) => call.name === "resume").length, 1);
});

for (const browser of ["Chrome", "Edge", "Firefox"]) {
  test(`${browser} private handoff reads only the matched private cookie store`, async () => {
    let saved;
    const f = fixture({
      includeSiteCookies: true,
      session: {
        get: async () => ({}),
        set: async (value) => {
          saved = value;
        },
      },
    });
    const storeId = browser === "Firefox" ? "firefox-private" : "1";
    f.api.extension = { isAllowedIncognitoAccess: async () => true };
    f.api.tabs = {
      query: async () => [
        {
          id: 17,
          incognito: false,
          url: "https://example.test/page",
          cookieStoreId: "regular",
        },
        {
          id: 18,
          incognito: true,
          url: "https://example.test/page",
          cookieStoreId: storeId,
        },
      ],
    };
    f.api.cookies.getAllCookieStores = async () => [
      { id: "regular", tabIds: [17] },
      { id: storeId, tabIds: [18] },
    ];
    const download = { ...item(17), incognito: true };
    if (browser === "Firefox") download.cookieStoreId = storeId;
    if (browser === "Edge") download.tabId = 18;
    await f.interceptor.created(download);
    const calls = f.calls.filter(({ name }) => name === "cookies");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].value.storeId, storeId);
    const request = f.calls.find(({ name }) => name === "request").value;
    assert.equal(request.privateSession, true);
    assert.equal(request.headers.Cookie, "session=abc");
    assert.doesNotMatch(JSON.stringify(saved), /session=abc|example.test/);
  });
}

test("ambiguous private cookie stores leave the original browser transfer untouched", async () => {
  const f = fixture({
    session: { get: async () => ({}), set: async () => {} },
  });
  f.api.tabs = {
    query: async () => [
      { id: 1, incognito: true, url: "https://example.test/page" },
      { id: 2, incognito: true, url: "https://example.test/page" },
    ],
  };
  f.api.cookies.getAllCookieStores = async () => [
    { id: "one", tabIds: [1] },
    { id: "two", tabIds: [2] },
  ];
  await f.interceptor.created({ ...item(42), incognito: true });
  assert.deepEqual(f.calls, []);
});

test("private cookie lookup failures resume the browser and never use another store", async () => {
  const f = fixture({
    includeSiteCookies: true,
    session: { get: async () => ({}), set: async () => {} },
    cookies: async () => {
      throw new Error("lookup refused");
    },
  });
  f.api.tabs = {
    query: async () => [
      { id: 2, incognito: true, url: "https://example.test/page" },
    ],
  };
  f.api.cookies.getAllCookieStores = async () => [
    { id: "private", tabIds: [2] },
  ];
  await f.interceptor.created({ ...item(42), incognito: true });
  assert.ok(f.calls.some(({ name }) => name === "resume"));
  assert.equal(f.calls.filter(({ name }) => name === "cookies").length, 1);
  assert.ok(!f.calls.some(({ name }) => name === "request"));
});
test("a retained native download is resumed only after GetANNY returns ownership", async () => {
  let stored = {};
  const f = fixture({
    session: {
      get: async () => stored,
      set: async (data) => {
        stored = data;
      },
    },
    request: async () => ({ action: "queued", retainBrowserCopy: true }),
  });
  await f.interceptor.created(item(91));
  assert.equal(
    f.calls.some(({ name }) => name === "cancel"),
    false,
  );
  assert.equal(stored.getannyHandoffs[0].stage, "owned");
  await f.interceptor.disconnected();
  assert.equal(
    f.calls.some(({ name }) => name === "resume"),
    false,
  );
  f.setRequest(async () => ({ action: "browser" }));
  await f.interceptor.reconnect();
  assert.equal(f.calls.filter(({ name }) => name === "resume").length, 1);
  assert.equal(stored.getannyHandoffs.length, 0);
});

test("a retained native download is discarded after desktop completion", async () => {
  const f = fixture({
    session: { set: async () => {} },
    request: async () => ({ action: "queued", retainBrowserCopy: true }),
  });
  await f.interceptor.created(item(92));
  f.setRequest(async () => ({ action: "completed" }));
  await f.interceptor.reconnect();
  assert.equal(f.calls.filter(({ name }) => name === "cancel").length, 1);
  assert.equal(
    f.calls.some(({ name }) => name === "resume"),
    false,
  );
});
