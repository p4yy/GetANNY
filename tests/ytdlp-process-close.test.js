const test = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {PassThrough} = require("node:stream");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {YtDlpWrapper} = require("../src/main/media/YtDlpWrapper");

function fakeSpawn(callback) {
  return (_program, args) => {
    const child = new EventEmitter();
    child.pid = 8901;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => callback(child,args));
    return child;
  };
}
test("yt-dlp completion does not depend on descendants closing inherited pipes", {timeout:5000}, async () => {
  let child;
  const wrapper = new YtDlpWrapper({
    executable:"fake-ytdlp",
    spawnProcess:fakeSpawn((proc)=>{
      child=proc;
      proc.stdout.write('GETANNY_PROGRESS:{"status":"downloading","downloaded_bytes":42}\n');
      // A grandchild still has stdout open, so no close event occurs.
      proc.emit("exit",0,null);
    }),
  });
  let progress=0;
  await wrapper.run([], {onProgress: value => {progress=value.downloaded_bytes;}});
  assert.equal(progress,42);
  assert.equal(child.stdout.destroyed,true);
  assert.equal(child.stderr.destroyed,true);
});
test("normal output pipe drain still settles promptly", {timeout:2000}, async () => {
  const wrapper=new YtDlpWrapper({
    executable:"fake-ytdlp",
    spawnProcess:fakeSpawn(child=>{
      child.stdout.write("expected output\n");
      child.stdout.end(); child.stderr.end();
      child.emit("exit",0,null); child.emit("close",0,null);
    }),
  });
  assert.equal(await wrapper.run([]),"expected output");
});
test("TikTok downloads canonicalize URLs and carry a short socket timeout and site referer", {timeout:3000}, async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"getanny-tiktok-source-"));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let args;
  const wrapper=new YtDlpWrapper({
    executable:"fake-ytdlp",
    spawnProcess:fakeSpawn((child,captured)=>{
      args=captured;
      child.stdout.end(); child.stderr.end();
      child.emit("exit",0,null); child.emit("close",0,null);
    }),
  });
  await wrapper.download({
    url:"https://www.tiktok.com/@creator/video/7371234567890123456?is_from_webapp=1",
    formatId:"best",
    outputTemplate:path.join(directory,"video.%(ext)s"),
    timeout:30,speedLimit:0,
  });
  const referer=args.indexOf("--add-header");
  assert.ok(referer>0);
  assert.equal(args[referer+1],"Referer: https://www.tiktok.com/");
  const socket=args.indexOf("--socket-timeout");
  assert.equal(args[socket+1],"15");
  assert.match(args.at(-1),/^https:\/\/www\.tiktok\.com\/@creator\/video\/7371234567890123456/);
});
