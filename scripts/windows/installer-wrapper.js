"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { finished } = require("node:stream/promises");

const MAGIC = Buffer.from("GETANNY-NSIS-V1\0","ascii");
const TRAILER_LENGTH = 64;

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest();
}

function makeTrailer(engineHash, engineBytes) {
  if (!Buffer.isBuffer(engineHash) || engineHash.length !== 32)
    throw new TypeError("The NSIS engine SHA-256 must be 32 bytes.");
  if (!Number.isSafeInteger(engineBytes) || engineBytes <= 0)
    throw new TypeError("The NSIS engine size is invalid.");
  const trailer = Buffer.alloc(TRAILER_LENGTH);
  engineHash.copy(trailer,0);
  trailer.writeBigUInt64LE(BigInt(engineBytes),32);
  MAGIC.copy(trailer,48);
  return trailer;
}

async function appendFile(output,file,completion) {
  for await (const chunk of fs.createReadStream(file)) {
    if (!output.write(chunk)) await Promise.race([once(output,"drain"),completion]);
  }
}

async function hashRange(file,start,length) {
  const hash=crypto.createHash("sha256");
  const input=fs.createReadStream(file,{start,end:start+length-1});
  for await(const chunk of input)hash.update(chunk);
  return hash.digest();
}

async function peLogicalEnd(handle,fileLength) {
  const readAt=async(length,position)=>{
    const buffer=Buffer.alloc(length);
    const result=await handle.read(buffer,0,length,position);
    if(result.bytesRead!==length)throw new Error("Installer PE header is truncated.");
    return buffer;
  };
  try{
    const peOffset=(await readAt(4,0x3c)).readUInt32LE(0);
    const signature=await readAt(4,peOffset);
    if(signature.toString("ascii")!=="PE\0\0")return fileLength;
    const magic=(await readAt(2,peOffset+24)).readUInt16LE(0);
    const dataDirectory=peOffset+24+(magic===0x20b?112:96);
    const security=await readAt(8,dataDirectory+4*8);
    const certificateOffset=security.readUInt32LE(0);
    const certificateSize=security.readUInt32LE(4);
    return certificateOffset>0&&certificateSize>0&&certificateOffset<=fileLength
      ? certificateOffset : fileLength;
  }catch(error){
    if(error.code==="ERR_OUT_OF_RANGE")return fileLength;
    throw error;
  }
}

async function verifyInstaller({installerPath,expectedShellPath}) {
  const stat=await fsp.stat(installerPath);
  if(!stat.isFile()||stat.size<TRAILER_LENGTH)throw new Error("Installer is too small to contain a GetANNY payload.");
  const handle=await fsp.open(installerPath,"r");
  let logicalEnd;
  let trailer;
  try{
    logicalEnd=await peLogicalEnd(handle,stat.size);
    if(logicalEnd<TRAILER_LENGTH)throw new Error("Installer has no GetANNY wrapper trailer.");
    trailer=Buffer.alloc(TRAILER_LENGTH);
    const result=await handle.read(trailer,0,TRAILER_LENGTH,logicalEnd-TRAILER_LENGTH);
    if(result.bytesRead!==TRAILER_LENGTH)throw new Error("Installer wrapper trailer is truncated.");
  }finally{await handle.close();}
  if(!trailer.subarray(48).equals(MAGIC))throw new Error("Installer is a raw NSIS executable; the branded GetANNY shell is missing.");
  const engineBytes=Number(trailer.readBigUInt64LE(32));
  if(!Number.isSafeInteger(engineBytes)||engineBytes<=0)throw new Error("Installer NSIS payload length is invalid.");
  const engineOffset=logicalEnd-TRAILER_LENGTH-engineBytes;
  if(engineOffset<=0)throw new Error("Installer does not contain a valid WPF shell and NSIS payload.");
  const engineHash=await hashRange(installerPath,engineOffset,engineBytes);
  if(!engineHash.equals(trailer.subarray(0,32)))throw new Error("Installer NSIS payload SHA-256 verification failed.");
  const shellHash=await hashRange(installerPath,0,engineOffset);
  if(expectedShellPath){
    const expected=await sha256(expectedShellPath);
    if(!shellHash.equals(expected))throw new Error("Installer does not contain the current GetANNY animated WPF shell.");
  }
  return {
    wrapped:true,
    signed:logicalEnd<stat.size,
    fileBytes:stat.size,
    logicalEnd,
    shellBytes:engineOffset,
    shellSha256:shellHash.toString("hex"),
    engineBytes,
    engineSha256:engineHash.toString("hex")
  };
}

async function wrapInstaller({shellPath,enginePath,outputPath,uninstallerPath}) {
  for(const file of [shellPath,enginePath,uninstallerPath].filter(Boolean)){
    const stat=await fsp.stat(file).catch(()=>null);
    if(!stat?.isFile()||stat.size<=0)throw new Error("Missing or empty installer input: "+file);
  }
  const shellBytes=(await fsp.stat(shellPath)).size;
  const engineBytes=(await fsp.stat(enginePath)).size;
  const shellHash=await sha256(shellPath);
  const engineHash=await sha256(enginePath);
  const trailer=makeTrailer(engineHash,engineBytes);
  const outputDirectory=path.dirname(outputPath);
  await fsp.mkdir(outputDirectory,{recursive:true});
  const temporary=outputPath+".building-"+process.pid;
  await fsp.rm(temporary,{force:true});
  const stream=fs.createWriteStream(temporary,{flags:"w"});
  const completion=finished(stream);
  try{
    await appendFile(stream,shellPath,completion);
    await appendFile(stream,enginePath,completion);
    if(!stream.write(trailer))await Promise.race([once(stream,"drain"),completion]);
    stream.end();
    await completion;
    const stat=await fsp.stat(temporary);
    if(stat.size!==shellBytes+engineBytes+TRAILER_LENGTH)
      throw new Error("Wrapped installer length does not match the expected payload layout.");
    const handle=await fsp.open(temporary,"r");
    try{
      const actual=Buffer.alloc(TRAILER_LENGTH);
      await handle.read(actual,0,TRAILER_LENGTH,stat.size-TRAILER_LENGTH);
      if(!actual.equals(trailer))throw new Error("Wrapped installer trailer verification failed.");
    }finally{await handle.close();}
    const embeddedHash=await hashRange(temporary,shellBytes,engineBytes);
    if(!embeddedHash.equals(engineHash))throw new Error("Embedded NSIS engine SHA-256 mismatch.");
    const embeddedShellHash=await hashRange(temporary,0,shellBytes);
    if(!embeddedShellHash.equals(shellHash))throw new Error("Embedded GetANNY shell SHA-256 mismatch.");
    await fsp.rm(outputPath,{force:true});
    await fsp.rename(temporary,outputPath);
  }catch(error){
    stream.destroy();
    await completion.catch(()=>{});
    await fsp.rm(temporary,{force:true});
    throw error;
  }
  const outputHash=await sha256(outputPath);
  const uninstallerBytes=uninstallerPath?(await fsp.stat(uninstallerPath)).size:null;
  return {
    outputPath,
    outputBytes:(await fsp.stat(outputPath)).size,
    outputSha256:outputHash.toString("hex"),
    shellBytes,
    shellSha256:shellHash.toString("hex"),
    engineBytes,
    engineSha256:engineHash.toString("hex"),
    trailerBytes:TRAILER_LENGTH,
    uninstallerPath:uninstallerPath||null,
    uninstallerBytes,
    wrapped:true
  };
}

module.exports={MAGIC,TRAILER_LENGTH,makeTrailer,sha256,wrapInstaller,verifyInstaller};
