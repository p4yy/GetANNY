const test = require("node:test");
const assert = require("node:assert/strict");
const {ResponsivenessWatchdog} = require("./responsiveness-watchdog");

test("regular ticks are not logged as stalls", () => {
  const alerts=[];
  const monitor=new ResponsivenessWatchdog({onStall:value=>alerts.push(value)});
  monitor.sample(0);
  monitor.sample(1000);
  monitor.sample(2050);
  monitor.sample(3050);
  assert.deepEqual(alerts,[]);
});

test("a long event-loop stall is recorded once and cooldown prevents spam", () => {
  const alerts=[];
  const monitor=new ResponsivenessWatchdog({
    intervalMs:1000,stallMs:5000,cooldownMs:60000,
    onStall:value=>alerts.push(value)
  });
  monitor.sample(0);
  monitor.sample(7100);
  monitor.sample(15000);
  assert.equal(alerts.length,1);
  assert.equal(alerts[0].lagMs,6100);
  monitor.sample(80000);
  assert.equal(alerts.length,2);
  assert.equal(alerts[1].lagMs,64000);
});

test("watchdog start is idempotent and stop releases its timer", () => {
  const monitor=new ResponsivenessWatchdog();
  monitor.start();
  const timer=monitor.timer;
  assert.ok(timer);
  monitor.start();
  assert.equal(monitor.timer,timer);
  monitor.stop();
  assert.equal(monitor.timer,null);
  assert.equal(monitor.expectedAt,null);
});
