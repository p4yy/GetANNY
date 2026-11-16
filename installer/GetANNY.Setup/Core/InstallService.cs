using System.Diagnostics;

namespace GetANNY.Setup.Core;

public sealed record InstallOptions(
    string Directory,
    bool DesktopShortcut,
    bool StartMenuShortcut,
    IReadOnlyList<string> PassThroughSwitches);

public sealed record InstallOutcome(string Directory, string ExecutablePath, bool WasUpgrade, TimeSpan Elapsed);

/// <summary>
/// Orchestrates one installation:
///   1. extract the NSIS engine from this EXE's overlay (verified by SHA-256)
///   2. inspect the current per-user registration (upgrade / repair detection)
///   3. run the engine silently with the user's choices
///   4. observe the engine's real side effects to narrate progress
///   5. verify the end state and clean up the temporary engine
///
/// The engine performs the actual file extraction, registry writes, shortcut
/// creation, in-place upgrade of an older version and browser-bridge provisioning
/// (via installer.nsh). Nothing is duplicated here — the shell never writes to the
/// install directory or to the registry.
/// </summary>
public sealed class InstallService
{
    private readonly Payload _payload;

    public InstallService(Payload payload) => _payload = payload;

    public async Task<InstallOutcome> RunAsync(InstallOptions options, IProgress<StageUpdate> progress, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        // Keep the trailing separator of a drive root (for example C:\\). Trimming it
        // would turn the path into the drive-relative location "C:".
        var targetDir = Path.GetFullPath(options.Directory);
        var exePath = Path.Combine(targetDir, Product.ExecutableName);
        var tempRoot = Path.Combine(Path.GetTempPath(), "GetANNY-Setup-" + Environment.ProcessId);
        var enginePath = Path.Combine(tempRoot, "GetANNY Setup.engine.exe");

        try
        {
            // 1 — Prepare
            progress.Report(new StageUpdate(InstallStages.Prepare, StageState.Active, "Unpacking the setup engine…", 0));
            await _payload.ExtractAsync(enginePath, new Progress<double>(f =>
                progress.Report(new StageUpdate(InstallStages.Prepare, StageState.Active, "Verifying setup engine…", f))), ct);
            progress.Report(new StageUpdate(InstallStages.Prepare, StageState.Done, "Verified"));

            // 2 — Detect
            progress.Report(new StageUpdate(InstallStages.Detect, StageState.Active));
            var existing = InstallationState.FindExisting();
            var wasUpgrade = existing is not null;
            if (existing is not null)
            {
                var sameVersion = string.Equals(existing.DisplayVersion, Product.Version, StringComparison.OrdinalIgnoreCase);
                var what = sameVersion ? "Repairing" : $"Upgrading from {existing.DisplayVersion ?? "an earlier version"}";
                progress.Report(new StageUpdate(InstallStages.Detect, StageState.Done, what));
                SetupLog.Info($"existing installation: {existing}");
                // If the app is running from the target folder, close it so the engine does not fail on locked files.
                if (AppProcesses.IsRunning(existing.InstallLocation ?? targetDir))
                {
                    progress.Report(new StageUpdate(InstallStages.Detect, StageState.Active, "Closing GetANNY…"));
                    if (!await AppProcesses.CloseAsync(existing.InstallLocation ?? targetDir, TimeSpan.FromSeconds(8), ct))
                        throw new OperationFailedException("GetANNY is still running and could not be closed. Close it and try again.");
                    progress.Report(new StageUpdate(InstallStages.Detect, StageState.Done, what));
                }
            }
            else
            {
                progress.Report(new StageUpdate(InstallStages.Detect, StageState.Done, "Fresh installation"));
            }

            ct.ThrowIfCancellationRequested();

            // 3 — Run the engine, 4 — observe
            var switches = new List<string> { "/S", "/currentuser" };
            if (!options.DesktopShortcut) switches.Add("--no-desktop-shortcut");
            if (!options.StartMenuShortcut) switches.Add("--no-start-menu-shortcut");
            foreach (var s in options.PassThroughSwitches)
                if (!switches.Contains(s, StringComparer.OrdinalIgnoreCase)) switches.Add(s);
            var args = CommandLine.BuildEngineArguments(switches, "/D=", targetDir);

            progress.Report(new StageUpdate(InstallStages.Files, StageState.Active, "Extracting files…"));
            var markerPath = Path.Combine(targetDir, Product.UpdateMarkerRelativePath);
            var wantsDesktop = options.DesktopShortcut;
            var wantsStart = options.StartMenuShortcut;
            if (!wantsDesktop && !wantsStart)
                progress.Report(new StageUpdate(InstallStages.Shortcuts, StageState.Skipped, "Not requested"));

            using var observerCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var observer = ObserveAsync(targetDir, exePath, markerPath, wantsDesktop, wantsStart, progress, observerCts.Token);

            // Cancellation inside the engine is not safe to honour (half-extracted app).
            // We let the engine finish and roll back afterwards if the user cancelled.
            var result = await NsisEngine.RunAsync(enginePath, args, tempRoot, CancellationToken.None);
            observerCts.Cancel();
            try { await observer; } catch (OperationCanceledException) { }

            if (!result.Succeeded)
                throw new OperationFailedException(NsisEngine.Describe(result.ExitCode));

            // 5 — Verify
            progress.Report(new StageUpdate(InstallStages.Files, StageState.Done));
            progress.Report(new StageUpdate(InstallStages.Register, InstallationState.UninstallKeyExists() ? StageState.Done : StageState.Failed));
            if (wantsDesktop || wantsStart)
            {
                var ok = (!wantsDesktop || Shortcuts.DesktopExists) && (!wantsStart || Shortcuts.StartMenuExists);
                progress.Report(new StageUpdate(InstallStages.Shortcuts, ok ? StageState.Done : StageState.Failed));
            }
            progress.Report(new StageUpdate(InstallStages.Browser, StageState.Done, "Native messaging hosts prepared"));

            progress.Report(new StageUpdate(InstallStages.Finish, StageState.Active));
            if (!File.Exists(exePath))
                throw new OperationFailedException($"Installation finished but {Product.ExecutableName} was not found in {targetDir}.");
            if (!InstallationState.UninstallKeyExists())
                throw new OperationFailedException("Installation finished but the Add/Remove Programs entry is missing.");
            if (InstallationState.CountEntries() > 1)
                SetupLog.Warn("more than one GetANNY uninstall entry is registered for this user");
            if (!File.Exists(markerPath))
                SetupLog.Warn("getanny-github-updates marker missing — auto-updates will be unavailable for this install");

            if (ct.IsCancellationRequested)
            {
                // The user cancelled while the engine was busy: undo the completed install cleanly.
                SetupLog.Warn("user cancelled after engine completion — rolling back");
                await RollbackAsync(targetDir);
                throw new OperationCanceledException(ct);
            }

            progress.Report(new StageUpdate(InstallStages.Finish, StageState.Done));
            sw.Stop();
            return new InstallOutcome(targetDir, exePath, wasUpgrade, sw.Elapsed);
        }
        finally
        {
            TryDeleteDirectory(tempRoot);
        }
    }

    /// <summary>Launches the installed app detached from the installer process.</summary>
    public static void LaunchApp(string exePath)
    {
        var psi = new ProcessStartInfo(exePath) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exePath)! };
        using var _ = Process.Start(psi);
    }

    /// <summary>
    /// Watches the engine's observable effects and promotes stages when they appear.
    /// electron-builder's install section order: extract files → write uninstaller →
    /// registry → shortcuts → customInstall (marker + browser hosts).
    /// </summary>
    private static async Task ObserveAsync(string dir, string exe, string marker, bool wantsDesktop, bool wantsStart, IProgress<StageUpdate> progress, CancellationToken ct)
    {
        bool files = false, reg = false, links = false, browser = false;
        var engineUninstaller = Path.Combine(dir, Product.EngineUninstallerFileName);
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(300, ct);
            if (!files && File.Exists(exe) && File.Exists(engineUninstaller))
            {
                files = true;
                progress.Report(new StageUpdate(InstallStages.Files, StageState.Done));
                progress.Report(new StageUpdate(InstallStages.Register, StageState.Active, "Writing Add/Remove Programs entry…"));
            }
            if (files && !reg && InstallationState.UninstallKeyExists())
            {
                reg = true;
                progress.Report(new StageUpdate(InstallStages.Register, StageState.Done));
                if (wantsDesktop || wantsStart)
                    progress.Report(new StageUpdate(InstallStages.Shortcuts, StageState.Active));
                else
                    progress.Report(new StageUpdate(InstallStages.Browser, StageState.Active, "Running GetANNY --setup-browser-hosts…"));
            }
            if (reg && !links && (!wantsDesktop || Shortcuts.DesktopExists) && (!wantsStart || Shortcuts.StartMenuExists))
            {
                links = true;
                if (wantsDesktop || wantsStart) progress.Report(new StageUpdate(InstallStages.Shortcuts, StageState.Done));
                progress.Report(new StageUpdate(InstallStages.Browser, StageState.Active, "Running GetANNY --setup-browser-hosts…"));
            }
            if (links && !browser && File.Exists(marker))
            {
                browser = true; // marker is written at the start of customInstall; the host setup follows
                progress.Report(new StageUpdate(InstallStages.Browser, StageState.Active, "Registering native messaging hosts for this user…"));
            }
        }
    }

    private static async Task RollbackAsync(string targetDir)
    {
        var uninstaller = Path.Combine(targetDir, Product.EngineUninstallerFileName);
        if (!File.Exists(uninstaller)) return;
        var temp = Path.Combine(Path.GetTempPath(), $"GetANNY-rollback-{Environment.ProcessId}.exe");
        File.Copy(uninstaller, temp, true);
        try
        {
            await NsisEngine.RunAsync(temp, CommandLine.BuildEngineArguments(new[] { "/S", "/currentuser" }, "_?=", targetDir), Path.GetTempPath(), CancellationToken.None, TimeSpan.FromMinutes(5));
        }
        finally { try { File.Delete(temp); } catch (IOException) { } }
    }

    private static void TryDeleteDirectory(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
