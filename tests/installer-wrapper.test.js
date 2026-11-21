const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const fsSync=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {MAGIC,TRAILER_LENGTH,wrapInstaller,verifyInstaller}=require("../scripts/windows/installer-wrapper");

function fakePeShell() {
  const bytes=Buffer.alloc(2048,0x31);
  bytes.write("MZ",0,"ascii");
  bytes.writeUInt32LE(0x80,0x3c);
  bytes.write("PE\0\0",0x80,"ascii");
  bytes.writeUInt16LE(0x20b,0x80+24);
  return bytes;
}

test("release wrapper embeds the original NSIS engine after the dark setup shell",async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"getanny-wrapper-"));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const shell=path.join(dir,"GetANNY.Setup.exe");
  const engine=path.join(dir,"GetANNY.Setup.engine.exe");
  const uninstaller=path.join(dir,"GetANNY Uninstall.exe");
  const output=path.join(dir,"GetANNY Setup.exe");
  const shellBytes=fakePeShell();
  const engineBytes=Buffer.concat([Buffer.from("MZ-NSIS-ENGINE"),Buffer.alloc(4096,0x52)]);
  await fs.writeFile(shell,shellBytes);
  await fs.writeFile(engine,engineBytes);
  await fs.copyFile(shell,uninstaller);
  const result=await wrapInstaller({shellPath:shell,enginePath:engine,outputPath:output,uninstallerPath:uninstaller});
  const wrapped=await fs.readFile(output);
  assert.deepEqual(wrapped.subarray(0,shellBytes.length),shellBytes);
  assert.deepEqual(wrapped.subarray(shellBytes.length,shellBytes.length+engineBytes.length),engineBytes);
  const trailer=wrapped.subarray(-TRAILER_LENGTH);
  assert.deepEqual(trailer.subarray(48),MAGIC);
  assert.equal(Number(trailer.readBigUInt64LE(32)),engineBytes.length);
  assert.deepEqual(trailer.subarray(0,32),crypto.createHash("sha256").update(engineBytes).digest());
  assert.equal(result.wrapped,true);
  assert.equal(result.outputBytes,shellBytes.length+engineBytes.length+TRAILER_LENGTH);
  assert.equal(result.shellSha256,crypto.createHash("sha256").update(shellBytes).digest("hex"));
  assert.equal(result.engineSha256,crypto.createHash("sha256").update(engineBytes).digest("hex"));
  const verified=await verifyInstaller({installerPath:output,expectedShellPath:shell});
  assert.equal(verified.wrapped,true);
  assert.equal(verified.signed,false);
  assert.equal(verified.shellBytes,shellBytes.length);
  assert.equal(verified.engineBytes,engineBytes.length);
});

test("release wrapper refuses missing shell or NSIS payload",async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"getanny-wrapper-missing-"));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const engine=path.join(dir,"engine.exe");
  await fs.writeFile(engine,"NSIS");
  await assert.rejects(()=>wrapInstaller({
    shellPath:path.join(dir,"missing-shell.exe"),
    enginePath:engine,
    outputPath:path.join(dir,"out.exe")
  }),/Missing or empty installer input/);
});

test("the NSIS release pipeline launches the dark WPF shell, not the raw wizard", () => {
  const root=path.resolve(__dirname,"..");
  const workflow=fsSync.readFileSync(path.join(root,".github/workflows/release.yml"),"utf8");
  const pages=fsSync.readFileSync(path.join(root,"installer/GetANNY.Setup/Views/Pages.xaml"),"utf8");
  const project=fsSync.readFileSync(path.join(root,"installer/GetANNY.Setup/GetANNY.Setup.csproj"),"utf8");
  const nsis=fsSync.readFileSync(path.join(root,"scripts/windows/installer.nsh"),"utf8");
  const builder=fsSync.readFileSync(path.join(root,"electron-builder.yml"),"utf8");
  assert.match(workflow,/wrap-installer-release\.js/);
  assert.match(workflow,/verify-installer-wrapper\.js/);
  assert.match(workflow,/\$arguments = '--capture "/);
  assert.match(workflow,/\+ \$capture \+ '"/);
  assert.match(workflow,/Start-Process -FilePath \$setupExe -ArgumentList \$arguments/);
  assert.match(workflow,/GetANNY-branded-installer-ui/);
  assert.match(builder,/from: installer\/publish\/GetANNY\.Setup\.exe/);
  assert.match(nsis,/GetANNY Uninstall\.exe/);
  assert.match(nsis,/WriteRegStr SHELL_CONTEXT.*UninstallString/);
  assert.match(project,/getanny-logo-animation\.gif/);
  assert.equal((pages.match(/AnimatedGifImage ResourceUri=/g)||[]).length,4);
  assert.match(pages,/IsUninstallerFlow/);
  assert.match(pages,/HorizontalContentAlignment="Stretch"/);
  assert.match(pages,/MinHeight="54"/);
});
