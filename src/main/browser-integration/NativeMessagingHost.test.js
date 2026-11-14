const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { NativeMessagingHost } = require("./NativeMessagingHost");
test("native host uses a real executable launcher and standard manifest fields, not unsupported args", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "getanny-host-manifest-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const host = new NativeMessagingHost({
    userDataPath: dir,
    home: dir,
    platform: "linux",
    appPath: process.execPath,
    token: "a".repeat(64),
    isPackaged: false,
  });
  const result = await host.register("chrome");
  const manifest = JSON.parse(await fs.readFile(result.path, "utf8"));
  const bridgeConfig = JSON.parse(
    await fs.readFile(path.join(host.base, "bridge-config.json"), "utf8"),
  );
  assert.equal(
    bridgeConfig.desktopExitMarker,
    path.join(host.base, "desktop-exit.json"),
  );
  assert.ok(manifest.path.endsWith("getanny-native-host"));
  assert.equal(manifest.args, undefined);
  assert.deepEqual(manifest.allowed_origins, [
    "chrome-extension://oocncjjghijimkajhmdjcgdffkfojpbg/",
  ]);
  assert.match(await fs.readFile(manifest.path, "utf8"), /--config/);
  assert.equal((await host.check("chrome")).registered, true);
  const firefox = await host.register("firefox");
  const fm = JSON.parse(await fs.readFile(firefox.path, "utf8"));
  assert.deepEqual(fm.allowed_extensions, ["getanny@getanny.app"]);
  assert.equal(fm.allowed_origins, undefined);
  await host.unregisterAll();
  assert.equal((await host.check("chrome")).registered, false);
});

test("Windows registration writes both registry views and browser-specific plus compatibility keys", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "getanny-host-windows-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "GetANNY.NativeHost.exe"), "MZfixture");
  const calls = [];
  const host = new NativeMessagingHost({
    userDataPath: dir,
    platform: "win32",
    appPath: "C:\\GetANNY\\GetANNY.exe",
    binPath: bin,
    token: "b".repeat(64),
    registryViews: ["64", "32"],
    run: async (command, args) => {
      calls.push({ command, args });
      return { stdout: "" };
    },
  });
  const result = await host.register("brave");
  const manifest = JSON.parse(await fs.readFile(result.path, "utf8"));
  assert.equal(manifest.name, "com.getanny.native");
  assert.deepEqual(
    calls.map(({ args }) => args.at(-1)),
    ["/reg:64", "/reg:32", "/reg:64", "/reg:32"],
  );
  assert.ok(
    calls.some(({ args }) =>
      args[1].includes("BraveSoftware\\Brave-Browser\\NativeMessagingHosts"),
    ),
  );
  assert.ok(
    calls.some(({ args }) =>
      args[1].includes("Google\\Chrome\\NativeMessagingHosts"),
    ),
  );
});

test("partial Windows registry-view registration is diagnosed instead of reported healthy", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "getanny-host-partial-registry-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "GetANNY.NativeHost.exe"), "MZfixture");
  const host = new NativeMessagingHost({
    userDataPath: dir,
    platform: "win32",
    appPath: "C:\\GetANNY\\GetANNY.exe",
    binPath: bin,
    token: "c".repeat(64),
    registryViews: ["64", "32"],
    run: async (_command, args) => {
      if (args.includes("/reg:32")) throw new Error("simulated denied view");
      return { stdout: "" };
    },
  });
  await assert.rejects(
    host.register("chrome"),
    /registration is incomplete.*32-bit.*denied view/i,
  );
});

test("Windows unregister reports owned registry entries it could not remove", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "getanny-host-unregister-registry-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const host = new NativeMessagingHost({
    userDataPath: dir,
    platform: "win32",
    registryViews: ["64", "32"],
    run: async (_command, args) => {
      if (args[0] === "query")
        return {
          stdout: `    (Default)    REG_SZ    ${host.manifestFile("chrome")}
`,
        };
      if (args[0] === "delete") throw new Error("simulated registry lock");
      return { stdout: "" };
    },
  });
  const result = await host.unregisterAll();
  assert.equal(result.removed, false);
  assert.ok(result.errors.length > 0);
  assert.match(result.errors[0], /registry lock/i);
});

test("Windows bridge cleanup removes legacy helper files while preserving unrelated files and registrations", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "getanny-legacy-bridge-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = path.join(root, "native-messaging");
  await fs.mkdir(old);
  await fs.writeFile(path.join(old, "GetANNY.NativeHost.exe"), "old helper");
  await fs.writeFile(path.join(old, "unrelated.txt"), "keep");
  const removed = [];
  const host = new NativeMessagingHost({
    userDataPath: root,
    platform: "win32",
    registryViews: ["64"],
    run: async (_command, args) => {
      if (args[0] === "delete") removed.push(args[1]);
      const owner = args[1].includes("Google\\Chrome")
        ? path.join(old, "com.getanny.native.chromium.json")
        : path.join(old, "other-app.json");
      return { stdout: `    (Default)    REG_SZ    ${owner}\r\n` };
    },
  });
  assert.equal(path.basename(host.base), "GetANNY Browser Bridge");
  assert.equal((await host.unregisterAll()).removed, true);
  assert.deepEqual(
    [...new Set(removed)],
    [
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.getanny.native",
    ],
  );
  await assert.rejects(fs.access(path.join(old, "GetANNY.NativeHost.exe")), {
    code: "ENOENT",
  });
  assert.equal(
    await fs.readFile(path.join(old, "unrelated.txt"), "utf8"),
    "keep",
  );
});
