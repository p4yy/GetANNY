using System.Diagnostics;

namespace GetANNY.Setup.Core;

/// <summary>Result of running the NSIS engine (installer or uninstaller) silently.</summary>
public sealed record EngineResult(int ExitCode, TimeSpan Elapsed, bool TimedOut)
{
    public bool Succeeded => ExitCode == 0 && !TimedOut;
}

/// <summary>
/// Runs an electron-builder NSIS executable with <c>/S</c> and waits for it.
///
/// NSIS exit codes (installer and uninstaller):
///   0 success · 1 aborted by user · 2 aborted by script (error)
///   electron-builder additionally quits with 2 for "app could not be closed".
/// The engine prints nothing on stdout in silent mode, so progress is observed by
/// the callers through file-system / registry checkpoints (see InstallService).
/// </summary>
public static class NsisEngine
{
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromMinutes(20);

    public static async Task<EngineResult> RunAsync(string enginePath, string arguments, string? workingDirectory, CancellationToken ct, TimeSpan? timeout = null)
    {
        if (!File.Exists(enginePath)) throw new FileNotFoundException("The setup engine is missing.", enginePath);

        var psi = new ProcessStartInfo
        {
            FileName = enginePath,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = workingDirectory ?? Path.GetTempPath(),
        };
        SetupLog.Info($"engine> \"{enginePath}\" {arguments}");

        var sw = Stopwatch.StartNew();
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("The setup engine could not be started.");
        using var timeoutCts = new CancellationTokenSource(timeout ?? DefaultTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
        try
        {
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException)
        {
            // A user cancel mid-install is not safe to honour by killing NSIS in
            // the middle of extraction; callers decide. We only kill on timeout.
            if (timeoutCts.IsCancellationRequested)
            {
                TryKillTree(process);
                SetupLog.Error($"engine timed out after {sw.Elapsed}");
                return new EngineResult(-1, sw.Elapsed, true);
            }
            throw;
        }
        sw.Stop();
        SetupLog.Info($"engine< exit {process.ExitCode} after {sw.Elapsed}");
        return new EngineResult(process.ExitCode, sw.Elapsed, false);
    }

    public static string Describe(int exitCode) => exitCode switch
    {
        0 => "Completed successfully.",
        1 => "The operation was cancelled.",
        2 => "The setup engine reported an error. GetANNY may still be running, or a file in the destination is locked.",
        3010 => "Completed. A restart is required to finish.",
        -1 => "The setup engine did not finish in time.",
        _ => $"The setup engine exited with code {exitCode}.",
    };

    private static void TryKillTree(Process p)
    {
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { }
    }
}
