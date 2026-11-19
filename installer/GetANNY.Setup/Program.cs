using GetANNY.Setup.Core;

namespace GetANNY.Setup;

public enum SetupRole { Installer, Uninstaller }

/// <summary>
/// Process entry point. Decides the role and whether a UI is needed *before* WPF
/// is initialised, so silent runs (electron-updater, CI, upgrades) never create a
/// window or a message pump.
///
/// Role resolution, in order:
///   --mode=install | --mode=uninstall                      explicit (tests)
///   this EXE carries an NSIS overlay                       → Installer
///   The NSIS uninstaller sits next to it, or _?= was passed   → Uninstaller
///   otherwise                                              → Installer without payload (shows a clear error)
/// </summary>
public static class Program
{
    public static CommandLine Args { get; private set; } = CommandLine.Parse(string.Empty);
    public static SetupRole Role { get; private set; }
    public static Payload? EnginePayload { get; private set; }

    [STAThread]
    public static int Main()
    {
        Args = CommandLine.Parse(Environment.CommandLine);
        SetupLog.Initialise(Args.LogPath);
        SetupLog.Info("argv: " + Environment.CommandLine);

        if (Args.IsHelp)
        {
            ShowUsage();
            return 0;
        }

        var exePath = Environment.ProcessPath!;
        EnginePayload = Payload.TryOpen(exePath);
        Role = ResolveRole(exePath);
        SetupLog.Info($"role={Role} payload={(EnginePayload is null ? "none" : EnginePayload.EngineLength + " bytes")}");

        try
        {
            if (Args.IsSilent)
                return RunSilent().GetAwaiter().GetResult();

            var app = new App();
            app.InitializeComponent();
            SetupLog.Info("Starting interactive WPF event loop");
            var exitCode = app.Run();
            SetupLog.Info("Interactive WPF event loop exited with code " + exitCode);
            return exitCode;
        }
        catch (Exception ex)
        {
            SetupLog.Error("fatal", ex);
            if (!Args.IsSilent)
                System.Windows.MessageBox.Show($"GetANNY Setup could not start.\n\n{ex.Message}\n\nLog: {SetupLog.Path}", "GetANNY Setup", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
            return 2;
        }
    }

    private static SetupRole ResolveRole(string exePath)
    {
        if (string.Equals(Args.Mode, "uninstall", StringComparison.OrdinalIgnoreCase)) return SetupRole.Uninstaller;
        if (string.Equals(Args.Mode, "install", StringComparison.OrdinalIgnoreCase)) return SetupRole.Installer;
        if (EnginePayload is not null) return SetupRole.Installer;
        if (Args.UninstallDirectory is not null) return SetupRole.Uninstaller;
        var dir = Path.GetDirectoryName(exePath);
        if (dir is not null && Product.FindEngineUninstaller(dir) is not null) return SetupRole.Uninstaller;
        if (string.Equals(Path.GetFileName(exePath), Product.ShellUninstallerFileName, StringComparison.OrdinalIgnoreCase)) return SetupRole.Uninstaller;
        return SetupRole.Installer;
    }

    /// <summary>
    /// Silent paths keep byte-for-byte NSIS semantics:
    ///   installer:   every switch is forwarded (/S /currentuser --updated --force-run …) plus /D=.
    ///   uninstaller: every switch is forwarded plus _?=  (see UninstallService.RunPassThroughAsync).
    /// </summary>
    private static async Task<int> RunSilent()
    {
        if (Role == SetupRole.Uninstaller)
            return await new UninstallService().RunPassThroughAsync(Args);

        if (EnginePayload is null)
        {
            SetupLog.Error("silent install requested but this executable has no setup payload");
            return 2;
        }

        var directory = InstallationState.ResolveInstallDirectory(Args.TargetDirectory);
        var passThrough = Args.Switches.Where(s =>
            !s.Equals("/S", StringComparison.OrdinalIgnoreCase) &&
            !s.StartsWith("--mode=", StringComparison.OrdinalIgnoreCase) &&
            !s.StartsWith("--log=", StringComparison.OrdinalIgnoreCase)).ToList();

        var options = new InstallOptions(directory, !Args.IsNoDesktopShortcut, !Args.IsNoStartMenuShortcut, passThrough);
        var progress = new Progress<StageUpdate>(u => SetupLog.Info($"stage {u.StageId}: {u.State} {u.Detail}"));
        try
        {
            var outcome = await new InstallService(EnginePayload).RunAsync(options, progress, CancellationToken.None);
            SetupLog.Info($"silent install complete: {outcome}");
            return 0;
        }
        catch (OperationFailedException ex)
        {
            SetupLog.Error("silent install failed: " + ex.Message);
            return 2;
        }
    }

    private static void ShowUsage()
    {
        const string usage =
            "GetANNY Setup\n\n" +
            "  GetANNY Setup.exe                      interactive installer\n" +
            "  GetANNY Setup.exe /S [/D=C:\\Path]       silent per-user install (NSIS-compatible)\n" +
            "      --no-desktop-shortcut  --no-start-menu-shortcut  --updated  --force-run\n\n" +
            "  GetANNY Uninstall.exe                  interactive uninstaller\n" +
            "  GetANNY Uninstall.exe /S [--delete-app-data] [_?=C:\\Path]\n\n" +
            "  --log=<file>   write the setup log to <file>";
        System.Windows.MessageBox.Show(usage, "GetANNY Setup", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Information);
    }

}
