const assert = require("node:assert/strict");
const os = require("node:os");
const { chromium, expect } = require("@playwright/test");
const { defaults } = require("../src/main/settings/schema");
const { launchOptions } = require("./browser-launch");

async function verifySelection() {
  const { preview } = await import("vite");
  const vite = await preview({ preview: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    browser = await chromium.launch(await launchOptions());
    const page = await browser.newPage({
      viewport: { width: 1280, height: 840 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ settings }) => {
        const downloads = Array.from({ length: 10000 }, (_, index) => ({
          id: `fixture-${index}`,
          url: `https://fixture.test/item-${index}.zip`,
          filename: `Fixture download ${index}`,
          category: "Archives",
          kind: "file",
          status: index === 0 ? "downloading" : "paused",
          createdAt: new Date(1700000000000 - index * 1000).toISOString(),
          totalSize: 1024,
          downloadedSize: 0,
        }));
        const bridge = { clients: 0, browsers: [] };
        const listeners = new Map();
        window.emitDownloadProgress = (progress) =>
          listeners.get("download:progress")?.(progress);
        window.getanny = {
          desktop: true,
          on(channel, listen) {
            listeners.set(channel, listen);
            return () => listeners.delete(channel);
          },
          invoke: async (channel, input) => {
            if (channel === "settings:set") {
              settings[input.key] = input.value;
              return { ...settings };
            }
            if (channel === "app:bootstrap")
              return {
                settings,
                downloads,
                bridge,
                pendingRequests: [],
                capabilities: {},
                platform: "win32",
                version: "selection-test",
              };
            if (channel === "browser:bridge-status") return bridge;
            if (channel === "app:window-state") return { maximized: false };
            if (channel === "updates:get-state") return { status: "idle" };
            return { url: null };
          },
        };
      },
      {
        settings: {
          ...defaults(os.tmpdir()),
          theme: "contrast",
          interfaceSize: "minimal",
          firstRunCompleted: true,
          welcomeCompleted: true,
        },
      },
    );
    const port = vite.httpServer.address().port;
    await page.goto(`http://127.0.0.1:${port}/`);
    const row = (index) =>
      page.locator(`[data-download-row="fixture-${index}"]`);
    const selection = page.locator(".selection-bar");
    await expect(row(0)).toBeVisible();
    await page.evaluate(() => {
      for (let tick = 1; tick <= 200; tick++)
        window.emitDownloadProgress({
          id: "fixture-0", downloadedSize: tick, speed: 1024 * tick,
        });
    });
    await expect(page.locator(".status-speed")).toContainText("200.0 KB/s");
    await expect(row(0)).toContainText("200 B");
    await page.keyboard.press("F1");
    const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(shortcuts).toBeVisible();
    await shortcuts
      .getByRole("searchbox", { name: "Search shortcuts" })
      .fill("New download");
    await shortcuts.getByRole("button", { name: "Mod+n", exact: true }).click();
    await page.keyboard.press("Control+Shift+n");
    await expect(
      shortcuts.getByRole("button", { name: "Mod+Shift+n", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcuts).toHaveCount(0);
    await page.keyboard.press("Control+Shift+n");
    const add = page.getByRole("dialog");
    await expect(add).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(add).toHaveCount(0);
    assert.ok(
      (await page.locator("[data-download-row]").count()) < 60,
      "the 10,000 rows must be windowed",
    );
    await row(0).focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(row(1)).toBeFocused();
    await expect(selection).toContainText("2 selected");
    await page.keyboard.press("Shift+End");
    await expect(row(9999)).toBeFocused();
    await expect(selection).toContainText("10000 selected");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Space" : "Control+Space",
    );
    await expect(selection).toContainText("9999 selected");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+a" : "Control+a",
    );
    await expect(selection).toContainText("10000 selected");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Home");
    await expect(row(0)).toBeFocused();
    const first = await row(0).boundingBox();
    const third = await row(2).boundingBox();
    assert.ok(first && third);
    const startX = first.x + first.width * 0.4;
    await page.mouse.move(startX, first.y + 5);
    await page.mouse.down();
    await page.mouse.move(startX + 35, third.y + 7, { steps: 6 });
    await expect(page.locator(".download-selection-band")).toBeVisible();
    await page.mouse.up();
    await expect(selection).toContainText("3 selected");
    await expect(page.locator(".download-selection-band")).toHaveCount(0);
    await expect(page.getByText("YOUR LIBRARY", { exact: true })).toHaveCount(0);
    await page.locator(".sidebar").getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Application", exact: true }).click();
    const panel = page.locator(".experience-settings");
    for (const width of [760, 1024, 1320]) {
      await page.setViewportSize({ width, height: 840 });
      await expect(panel).toBeVisible();
      await expect.poll(() => panel.evaluate((card) => {
        const box = card.getBoundingClientRect();
        const header = card.querySelector("h2").getBoundingClientRect();
        const save = card.querySelector(":scope > button").getBoundingClientRect();
        const grid = card.querySelector(".preference-grid");
        return header.top - box.top >= 17 && box.bottom - save.bottom >= 17 &&
          grid.scrollWidth <= grid.clientWidth + 1;
      })).toBe(true);
    }
    assert.deepEqual(errors, []);
    console.log(
      "Verified keyboard range selection, virtual focus, and mouse drag against 10,000 download rows.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => vite.httpServer.close(resolve));
  }
}
verifySelection().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
