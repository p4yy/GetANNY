const { execFile } = require("node:child_process");
const path = require("node:path");
class QueueAction {
  constructor(manager, desktop) {
    this.manager = manager;
    this.desktop = desktop;
    this.state = { action: "none", deadline: null };
    this.ids = new Set();
    manager.on("changed", () => this.update());
  }
  broadcast() {
    const win = this.desktop?.mainWindow();
    if (win && !win.isDestroyed())
      win.webContents.send("queue:action-state", this.state);
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.ids.clear();
    this.state = { action: "none", deadline: null };
    this.broadcast();
    return this.state;
  }
  arm(action) {
    if (action === "none") return this.cancel();
    if (!["quit", "sleep", "shutdown"].includes(action))
      throw new Error("Choose a supported queue action.");
    if (!this.desktop || (process.platform !== "win32" && action !== "quit"))
      throw new Error("This queue action requires Windows desktop.");
    const work = this.manager
      .getAll()
      .filter((i) => !["completed", "cancelled", "failed"].includes(i.status));
    if (!work.length)
      throw new Error("Add or resume a download before arming this action.");
    this.cancel();
    this.ids = new Set(work.map((i) => i.id));
    this.state = { action, deadline: null };
    this.broadcast();
    return this.state;
  }
  update() {
    if (this.state.action === "none") return;
    const items = this.manager.getAll();
    for (const i of items)
      if (!["completed", "cancelled", "failed"].includes(i.status))
        this.ids.add(i.id);
    const watched = items.filter((i) => this.ids.has(i.id));
    if (
      watched.some((i) => ["failed", "cancelled"].includes(i.status)) ||
      watched.length !== this.ids.size
    ) {
      this.cancel();
      return;
    }
    const ready =
      watched.length > 0 && watched.every((i) => i.status === "completed");
    if (!ready) {
      clearTimeout(this.timer);
      this.timer = null;
      this.state.deadline = null;
      this.broadcast();
      return;
    }
    if (this.state.deadline) return;
    this.state.deadline = Date.now() + 60000;
    this.broadcast();
    const window = this.desktop?.mainWindow();
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    this.timer = setTimeout(() => this.execute(), 60000);
    this.timer.unref?.();
  }
  execute() {
    const action = this.state.action;
    // Recheck at the deadline: new work or failure must never trigger power off.
    const items = this.manager.getAll();
    if (
      items.some(
        (i) => !["completed", "cancelled", "failed"].includes(i.status),
      ) ||
      [...this.ids].some(
        (id) => !items.some((i) => i.id === id && i.status === "completed"),
      )
    ) {
      this.cancel();
      return;
    }
    this.cancel();
    if (action === "quit") {
      this.desktop.app.quit();
      return;
    }
    const system = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
    );
    if (action === "shutdown")
      execFile(
        path.join(system, "shutdown.exe"),
        ["/s", "/t", "0"],
        { windowsHide: true },
        () => {},
      );
    if (action === "sleep")
      execFile(
        path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class GetANNYPower { [DllImport(\"powrprof.dll\", SetLastError=true)] public static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake); }'; [GetANNYPower]::SetSuspendState($false,$false,$false)",
        ],
        { windowsHide: true },
        () => {},
      );
  }
}
module.exports = { QueueAction };
