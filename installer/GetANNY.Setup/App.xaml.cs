using System.Windows;
using GetANNY.Setup.Core;
using GetANNY.Setup.ViewModels;
using GetANNY.Setup.Views;

namespace GetANNY.Setup;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        SetupLog.Info("WPF OnStartup invoked");

        DispatcherUnhandledException += (_, args) =>
        {
            SetupLog.Error("unhandled", args.Exception);
            MessageBox.Show($"An unexpected error occurred.\n\n{args.Exception.Message}\n\nLog: {SetupLog.Path}", "GetANNY Setup", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
            Shutdown(2);
        };

        if (Program.Args.CapturePath is { } captureDir)
        {
            // Verification mode used by scripts/windows/test-installers.ps1 (case 15).
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            _ = Dispatcher.InvokeAsync(async () =>
            {
                try { await UiCapture.RunAsync(captureDir, Program.Args, Program.EnginePayload); Shutdown(0); }
                catch (Exception ex) { SetupLog.Error("capture failed", ex); Shutdown(2); }
            });
            return;
        }

        var shell = new ShellViewModel(Program.Role, Program.Args, Program.EnginePayload);
        var window = new ShellWindow { DataContext = shell };
        shell.RequestClose += code => { window.Close(); Shutdown(code); };
        MainWindow = window;
        window.Show();
        SetupLog.Info("Setup window shown");
    }
}
