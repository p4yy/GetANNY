"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

test("Windows NSIS-only harness waits for async uninstall and CI collects separate browser source evidence", async () => {
  const script = await fs.readFile(
    "scripts/windows/test-installers.ps1",
    "utf8",
  );
  assert.match(script, /function Wait-ProductRemoved/);
  assert.match(
    script,
    /Wait-ProductRemoved \$installedExe \$uninstaller\.FullName/,
  );
  assert.doesNotMatch(script, /Start-Sleep -Seconds 2/);
  assert.doesNotMatch(script, /test-browser-matrix\.ps1/);
  assert.match(script, /browserExtensionTests='Skipped per owner request/);
  const uninstall = script.indexOf("Run-Checked $uninstaller.FullName");
  const wait = script.indexOf("Wait-ProductRemoved $installedExe");
  const catchFailure = script.indexOf("EXE cleanup gate failed");
  const report = script.indexOf("installer-report.json");
  const finalFailure = script.indexOf('if ($exeCleanupError) { throw');
  assert.ok(uninstall > -1 && uninstall < wait);
  assert.ok(wait < catchFailure && catchFailure < report && report < finalFailure);
  assert.doesNotMatch(script, /Installing the actual MSI package|portable-first-launch/);
  assert.match(script, /sourceCommit=\$env:GITHUB_SHA/);
  assert.match(script, /\$signatures/);

  const workflow = await fs.readFile(".github/workflows/release.yml", "utf8");
  const browser = workflow.indexOf("Test browser handoff and authenticated local bridge");
  const browserReport = workflow.indexOf("--test-reporter-destination=test-results/windows/browser-junit.xml");
  const installer = workflow.indexOf("./scripts/windows/test-installers.ps1");
  assert.ok(browser > -1 && browser < browserReport && browserReport < installer);
  const assembly = await fs.readFile("scripts/windows/assemble-release.ps1", "utf8");
  assert.match(assembly, /Browser handoff source test evidence is missing, failed or skipped/);
});

test("real-browser harnesses use current privileged Firefox startup and bounded Vivaldi/UI cleanup", async () => {
  const firefox = await fs.readFile("scripts/windows/test-firefox.js", "utf8");
  assert.match(
    firefox,
    /new firefox\.ServiceBuilder\(geckoExe\)\.addArguments\([\s\S]*"--allow-system-access"/,
  );
  assert.doesNotMatch(firefox, /remote-allow-system-access/);
  assert.match(firefox, /session\.credential === "provisioned"/);
  assert.match(firefox, /Connected · Secure local bridge/);

  const chromium = await fs.readFile(
    "scripts/windows/test-extension.js",
    "utf8",
  );
  assert.match(chromium, /new Set\(\[externalPid, externalProcess\?\.pid\]\)/);
  assert.match(
    chromium,
    /externalBrowser\.close\(\)[\s\S]*setTimeout\(resolve, 3000\)/,
  );

  const picker = await fs.readFile(
    "scripts/windows/select-extension-folder.ps1",
    "utf8",
  );
  assert.match(picker, /try\{\$dialog\.SetFocus\(\)\}catch\{\}/);
  assert.match(picker, /Folder-dialog address field is not focused/);
});

test("installed-app smoke fixtures are unique across reinstalls", async () => {
  const source = await fs.readFile("src/main/self-test.js", "utf8");
  assert.ok(source.includes("getanny-selftest=${randomUUID()}"));
  assert.ok(source.includes('payload.write(randomUUID(), 0, "utf8")'));
  assert.ok(source.includes("`local-${fixtureTag}.torrent`"));
  assert.ok(source.includes("`seed-${fixtureTag}.txt`"));
  assert.ok(source.includes("priorRunObserved: !!priorRun"));
});

test("Windows workflow builds the NSIS Setup EXE and requires explicit publication approval", async () => {
  const workflow = await fs.readFile(".github/workflows/release.yml", "utf8");
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.match(workflow, /electron-builder --win nsis --x64 --publish never/);
  assert.match(workflow, /Install, exercise, reinstall and uninstall NSIS Setup EXE/);
  assert.doesNotMatch(workflow, /electron-builder --win (?:appx|portable|msi)\b/);
  assert.doesNotMatch(workflow, /name: Build separate unsigned Microsoft Store AppX candidate/);
  assert.doesNotMatch(workflow, /name: Preserve Store preparation artifact/);
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+publish:[\s\S]*?default: false/);
  assert.match(workflow, /if:.*github\.event_name == 'workflow_dispatch' && inputs\.publish.*GetANNY-Release-Approved:/);
  const assembly = workflow.indexOf("./scripts/windows/assemble-release.ps1");
  const stage = workflow.indexOf("gh release create $tag --draft");
  const verify = workflow.indexOf("node scripts/verify-release-assets.js");
  const publish = workflow.indexOf("gh api --method PATCH");
  assert.ok(assembly > -1 && assembly < stage && stage < verify && verify < publish);
  const candidate = workflow.indexOf("Verify and select the exact installer from the release draft");
  const exercise = workflow.indexOf("./scripts/windows/test-installers.ps1");
  assert.ok(candidate > -1 && candidate < exercise && exercise < assembly);
  assert.match(workflow, /Get-FileHash -LiteralPath \$candidate\)\.Hash -ne \$env:CANDIDATE_SHA256/);
  assert.equal(pkg.scripts.dist, "npm run build:win");
  assert.match(pkg.scripts["build:win:store"], /disabled until the owner tests and approves/);
  assert.match(pkg.scripts.build, /electron-builder --win nsis --x64 --publish never/);
  // Store identity verification is retained as dormant source code only, not
  // run or distributed until the owner explicitly approves Store packaging.
  const verifier = await fs.readFile("scripts/windows/verify-store-appx.ps1", "utf8");
  assert.match(verifier, /AcevAppsCo\.GetANNYMediaDownloader/);
  assert.match(verifier, /CN=44221EAF-7759-44DD-9DA8-F00E45DF7108/);
  assert.match(verifier, /2\.6\.0\.0/);
  assert.match(verifier, /runFullTrust/);
});

test("installed Chromium handoff waits for asynchronous native cleanup acknowledgement", async () => {
  const script = await fs.readFile("scripts/windows/test-extension.js", "utf8");
  assert.match(script, /native browser download cancelled and history erased/);
  assert.match(script, /browser handoff ownership map cleared/);
  assert.match(script, /desktopQueued: entry\.desktopQueued/);
  const services = await fs.readFile("src/main/services.js", "utf8");
  assert.match(services, /Browser cleanup still unacknowledged/);
  assert.match(services, /ownerSessions\.delete\(id\)/);
});

test("Windows Chrome folder chooser bounds retries and never types outside the verified browser dialog", async () => {
  const picker = await fs.readFile("scripts/windows/select-extension-folder.ps1", "utf8");
  assert.match(picker, /GetForegroundWindow/);
  assert.match(picker, /for\(\$attempt=0;\$attempt -lt 6;\$attempt\+\+\)/);
  assert.match(picker, /\$focusKey = if\(\$attempt -ge 4\)\{'%n'\}/);
  assert.match(picker, /\$dialog\.GetRuntimeId\(\)/);
  assert.match(picker, /TreeWalker\]::ControlViewWalker\.GetParent/);
  assert.match(picker, /\$allowed\.Contains\(\[int\]\$candidate\.Current\.ProcessId\)/);
  assert.match(picker, /if\(-not \$address\)\{throw/);
});

test("Firefox actual browser cleanup waits for native history erase and never accepts search errors", async () => {
  const source = await fs.readFile("scripts/windows/test-firefox.js", "utf8");
  assert.match(source, /Firefox native entry was not cancelled and erased after handoff/);
  assert.match(source, /await waitFor\([\s\S]*?driver\.executeAsyncScript\(function \(url, done\)/);
  assert.match(source, /browser\.downloads\.search\(\{\}\)/);
  assert.match(source, /\(\) => done\(false\)/);
  assert.doesNotMatch(source, /const remainingNative = await driver\.executeAsyncScript/);
});
test("Vivaldi file chooser attempts both standard focus shortcuts but requires browser-owned Edit", async () => {
  const picker = await fs.readFile("scripts/windows/select-extension-folder.ps1", "utf8");
  assert.match(picker, /if\(\$attempt % 2 -eq 0\)\{'%d'\}else\{'\^l'\}/);
  assert.match(picker, /GetForegroundWindow/);
  assert.match(picker, /\$allowed\.Contains\(\[int\]\$candidate\.Current\.ProcessId\)/);
  assert.match(picker, /\$isDialogChild/);
  assert.match(picker, /Folder-dialog address field is not focused/);
});

test("Windows picker permits a direct UIA address child only after dialog and process ancestry checks", async () => {
  const source = await fs.readFile("scripts/windows/select-extension-folder.ps1", "utf8");
  assert.match(source, /\$edit\.Current\.ProcessId/);
  assert.match(source, /Address\|Location/);
  assert.match(source, /\$verifiedAddress -or -not \$underDialog/);
  assert.match(source, /\$address\.SetFocus\(\)/);
  assert.match(source, /\$focusedForEnter\.GetRuntimeId\(\)/);
  assert.match(source, /Folder dialog lost foreground before path selection/);
});

test("NSIS harness restores default native hosts before ownership and uninstall checks", async () => {
  const ps = await fs.readFile("scripts/windows/test-installers.ps1","utf8");
  const restore = ps.indexOf("Run-Checked $installedExe @('--setup-browser-hosts','--quiet') 90000");
  const owner = ps.indexOf("Owned-NativeEntries $defaultData",restore);
  const uninstall = ps.indexOf("Run-Checked $uninstaller.FullName @('/S')",owner);
  assert.ok(restore > -1 && restore < owner && owner < uninstall);
  assert.match(ps,/Native owner restore\/verification failed\. Continue real uninstall then fail/);
  assert.match(ps,/if \(\$nativeRestoreError\) \{ throw "NSIS native registration gate failed/);
  assert.match(ps,/Missing or overwritten:/);
});

test("Chrome real folder picker falls back to verified Windows UIA file-dialog control 1148", async () => {
  const picker = await fs.readFile("scripts/windows/select-extension-folder.ps1", "utf8");
  assert.match(picker, /\$node\.Current\.AutomationId -eq '1148'/);
  assert.match(picker, /if\(-not \$is1148 -or -not \$underDialog\)\{continue\}/);
  assert.match(picker, /if\(\$folderPathEdit\)/);
  assert.match(picker, /GetForegroundWindow\(\) -ne \$dialogHandle/);
  assert.match(picker, /\$folderPathEdit\.GetCurrentPattern\(\[System\.Windows\.Automation\.ValuePattern\]::Pattern\)\.SetValue\(\$Directory\)/);
  assert.match(picker, /Unexpected folder chooser button/);
  assert.match(picker, /if\(-not \$address\)\{throw/);
});

test("Chrome and Edge use the developer installer and Vivaldi uses real extension tabs", async () => {
  const source = await fs.readFile("scripts/windows/test-extension.js", "utf8");
  assert.match(source, /\["chrome", "edge"\]\.includes\(browserId\)/);
  assert.match(source, /Extensions\.loadUnpacked/);
  assert.match(source, /installed\.id !== CHROMIUM_ID/);
  assert.match(source, /chrome\.tabs\.create/);
  assert.match(source, /ordinary browser-download interception/);
  assert.match(source, /Ordinary intercepted download hash mismatch/);
  assert.match(source, /native browser download cancelled and history erased/);
});

test("NSIS uninstaller waits for real shortcut removal and fails closed if links survive", async () => {
  const script = await fs.readFile("scripts/windows/test-installers.ps1", "utf8");
  assert.match(script, /Wait-ProductRemoved \$installedExe \$uninstaller\.FullName \$exeShortcuts/);
  assert.match(script, /\(@\(\$Shortcuts \| Where-Object \{ Test-Path -LiteralPath \$_\.path \}\)\.Count -gt 0\)/);
  assert.match(script, /remainingShortcuts=\$links/);
  assert.match(script, /Uninstallation left shortcut \$\(\$link\.path\)/);
  assert.match(script, /exe-uninstall-timeout\.json/);
});

test("NSIS asynchronous uninstall waits for owned shortcuts and preserves strict cleanup", async () => {
  const script = await fs.readFile("scripts/windows/test-installers.ps1", "utf8");
  assert.match(script, /function Wait-ProductRemoved\(\[string\] \$InstalledExe, \[string\] \$UninstallerPath, \$Shortcuts/);
  assert.match(script, /Wait-ProductRemoved \$installedExe \$uninstaller\.FullName \$exeShortcuts/);
  assert.match(script, /remainingShortcuts=\$links/);
  assert.match(script, /EXE uninstallation did not remove all product files and shortcuts/);
  assert.match(script, /foreach \(\$link in \$Shortcuts\) \{ if \(Test-Path \$link\.path\) \{ throw/);
  assert.doesNotMatch(script, /Remove-Item[^\n]*GetANNY\.lnk/);
});

test("Chrome picker tries native Alt+N only after proving browser-owned dialog focus", async () => {
  const ps = await fs.readFile("scripts/windows/select-extension-folder.ps1","utf8");
  assert.match(ps,/for\(\$attempt=0;\$attempt -lt 6;\$attempt\+\+\)/);
  assert.match(ps,/\$focusKey = if\(\$attempt -ge 4\)\{'%n'\}/);
  assert.match(ps,/if\(\$isDialogChild\)\{\$address=\$candidate;break\}/);
  assert.match(ps,/if\(-not \$address\)\{throw/);
});
test("browser matrix runs the actual Edge binary and keeps unexpected browser failures strict", async () => {
  const ps = await fs.readFile("scripts/windows/test-browser-matrix.ps1", "utf8");
  assert.ok(ps.includes("msedge.exe"));
  assert.ok(ps.includes("'firefox','chrome','edge'"));
  assert.ok(ps.includes("An available browser failed real extension/native/download tests"));
});

test("NSIS harness exit status reflects native ownership and product cleanup", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows PowerShell harness");
  const { spawnSync } = require("node:child_process");
  const script = await fs.readFile("scripts/windows/test-installers.ps1", "utf8");
  const outcome = script.slice(script.lastIndexOf("if ($exeCleanupError) { throw"));
  for (const result of ["", "ownership failure", "cleanup failure"]) {
    const setup = [
      "$ErrorActionPreference = 'Stop'",
      "cmd.exe /d /c exit 1",
      "$exeCleanupError = " + (result === "cleanup failure" ? "'cleanup failure'" : "$null"),
      "$nativeRestoreError = " + (result === "ownership failure" ? "'ownership failure'" : "$null"),
    ].join("\n");
    const encoded = Buffer.from(setup + "\n" + outcome, "utf16le").toString("base64");
    const run = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.ifError(run.error);
    assert.equal(run.status, result ? 1 : 0, run.stdout + run.stderr);
    if (result) assert.ok(run.stderr.includes(result), run.stderr);
  }
});

test("packaged NSIS verification measures idle tray CPU and RAM and validates bridge wake", async () => {
  const ps = await fs.readFile("scripts/windows/test-installers.ps1", "utf8");
  const app = await fs.readFile("src/main/main.js", "utf8");
  assert.match(ps, /Self-Test \$installedExe 'exe-tray-idle' \(Join-Path \$installRoot 'exe-tray-data'\) -Tray/);
  assert.match(ps, /if \(\$Tray\) \{ \$arguments \+= '--tray-self-test' \}/);
  assert.match(ps, /\$idle\.rendererReleased/);
  assert.match(ps, /\$idle\.bridgeStayedAvailable/);
  assert.match(ps, /\$idle\.browserRequestWokeWindow/);
  assert.match(ps, /\$idle\.reportedWorkingSetMiB/);
  assert.match(ps, /\$idle\.idleCpuMicrosOver10Seconds/);
  assert.match(app, /await delay\(10000\)/);
});
