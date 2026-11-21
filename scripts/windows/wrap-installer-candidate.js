"use strict";

// Local-only wrapper build. It never reads or writes dist/, release metadata,
// GitHub, signing credentials, or the currently installed Setup.exe.
const fs=require("node:fs");
const path=require("node:path");
const {wrapInstaller}=require("./installer-wrapper");

const root=path.resolve(__dirname,"..","..");
const shell=path.join(root,"installer","publish","GetANNY.Setup.exe");
const engine=path.join(root,"installer","artifacts","raw","GetANNY Setup.exe");
const outputDir=path.join(root,"installer","artifacts");
const output=path.join(outputDir,"GetANNY Setup - Local Candidate.exe");
const uninstaller=path.join(outputDir,"GetANNY Uninstall.exe");
const reportPath=path.join(outputDir,"local-candidate-report.json");

async function main(){
  for(const required of [shell,engine]){
    if(!fs.existsSync(required))throw new Error("Missing build input: "+required);
  }
  fs.mkdirSync(outputDir,{recursive:true});
  fs.copyFileSync(shell,uninstaller);
  const result=await wrapInstaller({
    shellPath:shell,
    enginePath:engine,
    outputPath:output,
    uninstallerPath:uninstaller
  });
  fs.writeFileSync(reportPath,JSON.stringify({
    builtAt:new Date().toISOString(),
    localOnly:true,
    signed:false,
    setup:path.relative(root,output),
    uninstallerShell:path.relative(root,uninstaller),
    ...result
  },null,2)+"\n");
  console.log("Created local candidate: "+output);
  console.log("WPF shell "+result.shellBytes+" B + NSIS engine "+result.engineBytes+" B.");
  console.log("Candidate is unsigned and was not copied to dist/ or published.");
}
main().catch(error=>{console.error("wrap-installer-candidate:",error);process.exitCode=1;});
