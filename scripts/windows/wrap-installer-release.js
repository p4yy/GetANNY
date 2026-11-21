"use strict";

const fs=require("node:fs");
const path=require("node:path");
const {wrapInstaller,verifyInstaller}=require("./installer-wrapper");

async function main(){
  const root=path.resolve(__dirname,"..","..");
  const shell=path.join(root,"installer","publish","GetANNY.Setup.exe");
  const output=path.join(root,"dist","GetANNY Setup.exe");
  const rawDirectory=path.join(root,"installer","artifacts","raw");
  const rawEngine=path.join(rawDirectory,"GetANNY Setup.exe");
  const installedUninstaller=path.join(root,"dist","win-unpacked","GetANNY Uninstall.exe");
  const report=path.join(root,"test-results","windows","installer-wrapper.json");
  for(const file of [shell,output,installedUninstaller]){
    if(!fs.existsSync(file))throw new Error("Required setup artifact is missing: "+path.relative(root,file));
  }
  fs.mkdirSync(rawDirectory,{recursive:true});
  try {
    await verifyInstaller({installerPath:output});
    throw new Error("Refusing to wrap an installer that already contains the GetANNY shell.");
  } catch (error) {
    if (!String(error.message).includes("raw NSIS executable")) throw error;
  }
  fs.copyFileSync(output,rawEngine);
  const result=await wrapInstaller({
    shellPath:shell,
    enginePath:rawEngine,
    outputPath:output,
    uninstallerPath:installedUninstaller
  });
  // The NSIS blockmap describes the raw engine, not the wrapped EXE.
  // Remove it so the updater safely falls back to a full download.
  fs.rmSync(output+".blockmap",{force:true});
  fs.mkdirSync(path.dirname(report),{recursive:true});
  fs.writeFileSync(report,JSON.stringify({
    builtAt:new Date().toISOString(),
    product:"GetANNY",
    installerExperience:"Original dark WPF shell with embedded animated logo",
    installationEngine:"Electron Builder NSIS",
    ...Object.fromEntries(Object.entries(result).map(([key,value])=>
      [key,key.endsWith("Path")?path.relative(root,value):value]))
  },null,2)+"\n");
  console.log("Restored the branded GetANNY setup shell around the NSIS engine.");
  console.log("Installer: "+path.relative(root,output));
  console.log("NSIS engine SHA-256: "+result.engineSha256);
  console.log("WPF shell SHA-256: "+result.shellSha256);
  console.log("Final installer SHA-256: "+result.outputSha256);
  console.log("Matching WPF uninstaller shell: "+path.relative(root,installedUninstaller));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
