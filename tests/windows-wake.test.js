const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WindowsWakeSchedule,
} = require("../src/main/settings/WindowsWakeSchedule");
const { defaults, validateSetting } = require("../src/main/settings/schema");

test("scheduled wake is opt-in and serializes registration, rescheduling and removal", async () => {
  const settings = defaults("unused");
  assert.equal(settings.scheduleWakeEnabled, false);
  assert.throws(() => validateSetting("scheduleWakeEnabled", "true"));

  const executable = "C:\\Program Files\\GetANNY\\GetANNY.exe";
  const applied = [];
  const wake = new WindowsWakeSchedule({
    executable,
    async run(program, args, options) {
      const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
      assert.equal(program, "powershell.exe");
      assert.match(script, /WakeToRun = \$true/);
      assert.match(script, /Arguments = '--scheduled-downloads'/);
      assert.equal(options.windowsHide, true);
      assert.equal(options.env.GETANNY_WAKE_EXECUTABLE, executable);
      applied.push(options.env.GETANNY_WAKE_START);
    },
  });
  const enabled = {
    scheduleEnabled: true,
    scheduleWakeEnabled: true,
    scheduleStartMinute: 0,
    scheduleEndMinute: 360,
  };
  await Promise.all([
    wake.configure(enabled),
    wake.configure(enabled),
    wake.configure({ ...enabled, scheduleStartMinute: 120 }),
    wake.configure({ ...enabled, scheduleStartMinute: 360 }),
    wake.remove(),
  ]);
  assert.deepEqual(applied, ["0", "120", ""]);
});

test("a scheduler error leaves the configuration eligible for retry", async () => {
  let attempts = 0;
  const wake = new WindowsWakeSchedule({
    executable: "GetANNY.exe",
    async run() {
      if (++attempts === 1) throw new Error("Scheduler unavailable");
    },
  });
  await assert.rejects(wake.remove(), /Scheduler unavailable/);
  await wake.remove();
  assert.equal(attempts, 2);
});
