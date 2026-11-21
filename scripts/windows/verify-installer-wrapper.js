"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {verifyInstaller}=require("./installer-wrapper");
async function main(){
  const root=path.resolve(__dirname,"..","..");
  const installer=path.join(root,"dist","GetANNY Setup.exe");
  const shell=path.join(root,"installer","publish","GetANNY.Setup.exe");
  const uninstaller=path.join(root,"dist","win-unpacked","GetANNY Uninstall.exe");
  if(!fs.existsSync(uninstaller))throw new Error("The WPF uninstaller shell was not packaged into the app.");
  const result=await verifyInstaller({installerPath:installer,expectedShellPath:shell});
  console.log("Verified GetANNY branded installer wrapper:");
  const evidence={
    ...result,
    installer:path.relative(root,installer),
    uninstaller:path.relative(root,uninstaller),
    uninstallerBytes:fs.statSync(uninstaller).size
  };
  const report=path.join(root,"test-results","windows","installer-wrapper.json");
  fs.mkdirSync(path.dirname(report),{recursive:true});
  fs.writeFileSync(report,JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify(evidence,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
