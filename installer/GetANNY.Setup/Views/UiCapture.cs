using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using GetANNY.Setup.Core;
using GetANNY.Setup.Mvvm;
using GetANNY.Setup.ViewModels;

namespace GetANNY.Setup.Views;

/// <summary>
/// Verification mode: <c>GetANNY Setup.exe --capture "dir"</c>.
/// Shows the real shell window, navigates through every installer and uninstaller
/// page and renders each one at 100 / 125 / 150 / 200 % into PNG files. CI checks
/// the output dimensions and theme; humans review the images. No engine is run and
/// nothing is written outside the capture directory.
/// </summary>
public static class UiCapture
{
    private static readonly double[] Scales = { 1.0, 1.25, 1.5, 2.0 };

    public static async Task RunAsync(string directory, CommandLine args, Payload? payload)
    {
        Directory.CreateDirectory(directory);
        var shell = new ShellViewModel(SetupRole.Installer, args, payload);
        var window = new ShellWindow { DataContext = shell, WindowStartupLocation = WindowStartupLocation.Manual, Left = -10000, Top = -10000, ShowActivated = false, ShowInTaskbar = false };
        window.Show();
        try
        {
            foreach (var (name, page) in Pages(shell, payload))
            {
                shell.Navigate(page);
                await Settle();
                foreach (var scale in Scales)
                    Render(window, Path.Combine(directory, $"{name}-{(int)(scale * 100)}.png"), scale);
            }
        }
        finally
        {
            window.Close();
        }
        SetupLog.Info($"captured {Pages(shell, payload).Count() * Scales.Length} images to {directory}");
    }

    private static IEnumerable<(string Name, ObservableObject Page)> Pages(ShellViewModel shell, Payload? payload)
    {
        yield return ("install-welcome", new WelcomeViewModel(shell));
        yield return ("install-options", new OptionsViewModel(shell));

        var installProgress = new ProgressViewModel(shell, "Installing GetANNY", "This usually takes less than a minute.", InstallStages.All, (_, _) => new TaskCompletionSource().Task, () => { });
        installProgress.SeedPreview("Extracting files…", true, 0,
            (InstallStages.Prepare, StageState.Done, "Verified"),
            (InstallStages.Detect, StageState.Done, "Fresh installation"),
            (InstallStages.Files, StageState.Active, null));
        yield return ("install-progress", installProgress);

        yield return ("install-complete", new CompleteViewModel(shell, new InstallOutcome(Product.DefaultInstallDirectory, Path.Combine(Product.DefaultInstallDirectory, Product.ExecutableName), false, TimeSpan.FromSeconds(31))));

        yield return ("uninstall-confirm", new UninstallConfirmViewModel(shell, Product.DefaultInstallDirectory));

        var uninstallProgress = new ProgressViewModel(shell, "Uninstalling GetANNY", "Your downloads, history and settings are kept.", UninstallStages.All, (_, _) => new TaskCompletionSource().Task, () => { });
        uninstallProgress.SeedPreview("Removing files from " + Product.DefaultInstallDirectory, true, 0,
            (UninstallStages.Close, StageState.Done, "Not running"),
            (UninstallStages.Browser, StageState.Done, "Registrations removed"),
            (UninstallStages.Files, StageState.Active, null),
            (UninstallStages.Data, StageState.Skipped, "Kept"));
        yield return ("uninstall-progress", uninstallProgress);

        yield return ("uninstall-complete", new UninstallCompleteViewModel(shell, false));
    }

    private static async Task Settle()
    {
        for (var i = 0; i < 3; i++)
            await Application.Current.Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.ApplicationIdle);
        await Task.Delay(120);
    }

    private static void Render(Window window, string file, double scale)
    {
        var root = (FrameworkElement)window.Content;
        var width = (int)Math.Round(root.ActualWidth * scale);
        var height = (int)Math.Round(root.ActualHeight * scale);
        var bitmap = new RenderTargetBitmap(width, height, 96 * scale, 96 * scale, PixelFormats.Pbgra32);
        bitmap.Render(root);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var fs = File.Create(file);
        encoder.Save(fs);
    }

}
