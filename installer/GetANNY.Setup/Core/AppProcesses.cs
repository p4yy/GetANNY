using System.Diagnostics;

namespace GetANNY.Setup.Core;

/// <summary>
/// Finds and closes GetANNY processes running from a given install directory.
/// Graceful first (WM_CLOSE to every top-level window of the process, then
/// CloseMainWindow), forceful after a timeout. Only processes whose main module
/// lives under the install directory are touched — a GetANNY of another user or
/// a portable copy elsewhere is left alone.
/// </summary>
public static class AppProcesses
{
    public static IReadOnlyList<Process> Find(string installDirectory)
    {
        var prefix = Path.GetFullPath(installDirectory).TrimEnd('\\') + "\\";
        var list = new List<Process>();
        foreach (var name in new[] { "GetANNY", "GetANNY.NativeHost" })
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                try
                {
                    var path = p.MainModule?.FileName;
                    if (path is not null && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) { list.Add(p); continue; }
                }
                catch (System.ComponentModel.Win32Exception) { /* different user / access denied */ }
                catch (InvalidOperationException) { /* exited */ }
                p.Dispose();
            }
        }
        return list;
    }

    public static bool IsRunning(string installDirectory)
    {
        var procs = Find(installDirectory);
        foreach (var p in procs) p.Dispose();
        return procs.Count > 0;
    }

    /// <summary>Returns true when no owned process remains.</summary>
    public static async Task<bool> CloseAsync(string installDirectory, TimeSpan graceful, CancellationToken ct)
    {
        var procs = Find(installDirectory);
        if (procs.Count == 0) return true;
        SetupLog.Info($"closing {procs.Count} GetANNY process(es)");
        try
        {
            foreach (var p in procs)
            {
                try
                {
                    Interop.NativeMethods.PostCloseToProcessWindows((uint)p.Id);
                    p.CloseMainWindow();
                }
                catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
            }

            var deadline = DateTime.UtcNow + graceful;
            while (DateTime.UtcNow < deadline && procs.Any(p => !SafeHasExited(p)))
                await Task.Delay(250, ct);

            foreach (var p in procs.Where(p => !SafeHasExited(p)))
            {
                SetupLog.Warn($"force-terminating PID {p.Id}");
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { }
            }
            var hardDeadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
            while (DateTime.UtcNow < hardDeadline && procs.Any(p => !SafeHasExited(p)))
                await Task.Delay(200, ct);
            return procs.All(SafeHasExited);
        }
        finally
        {
            foreach (var p in procs) p.Dispose();
        }
    }

    private static bool SafeHasExited(Process p)
    {
        try { return p.HasExited; } catch (InvalidOperationException) { return true; } catch (System.ComponentModel.Win32Exception) { return true; }
    }
}
