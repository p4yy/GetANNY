using System.Windows;
using GetANNY.Setup.Core;
using GetANNY.Setup.Mvvm;
using Microsoft.Win32;

namespace GetANNY.Setup.ViewModels;

// ───────────────────────────── Installer · Screen 1 ─────────────────────────────

public sealed class WelcomeViewModel : ObservableObject
{
    private readonly ShellViewModel _shell;

    public WelcomeViewModel(ShellViewModel shell)
    {
        _shell = shell;
        InstallCommand = new RelayCommand(() => _shell.Navigate(new OptionsViewModel(_shell)), () => _shell.Payload is not null);
        CancelCommand = new RelayCommand(() => _shell.Exit(1));
        Existing = InstallationState.FindExisting();
    }

    public string Title => "Install GetANNY";
    public string Description => Product.Tagline;
    public string Version => "Version " + Product.Version;
    public ExistingInstallation? Existing { get; }
    public bool HasPayload => _shell.Payload is not null;
    public string? ExistingNote => Existing is null ? null :
        string.Equals(Existing.DisplayVersion, Product.Version, StringComparison.OrdinalIgnoreCase)
            ? $"Version {Existing.DisplayVersion} is already installed. Setup will repair it in place."
            : $"Version {Existing.DisplayVersion ?? "unknown"} is installed. Setup will upgrade it in place; your downloads and settings are kept.";
    public string? PayloadError => HasPayload ? null : "This copy of Setup does not contain the installation package. Download “GetANNY Setup.exe” again from the official release page.";

    public RelayCommand InstallCommand { get; }
    public RelayCommand CancelCommand { get; }
}

// ───────────────────────────── Installer · Screen 2 ─────────────────────────────

public sealed class OptionsViewModel : ObservableObject
{
    private readonly ShellViewModel _shell;
    private string _directory;
    private bool _desktop = true;
    private bool _startMenu = true;
    private string? _validation;

    public OptionsViewModel(ShellViewModel shell)
    {
        _shell = shell;
        _directory = InstallationState.ResolveInstallDirectory(shell.Args.TargetDirectory);
        if (shell.Args.IsNoDesktopShortcut) _desktop = false;
        if (shell.Args.IsNoStartMenuShortcut) _startMenu = false;
        BackCommand = new RelayCommand(() => _shell.Navigate(new WelcomeViewModel(_shell)));
        BrowseCommand = new RelayCommand(Browse);
        ResetCommand = new RelayCommand(() => Directory = Product.DefaultInstallDirectory);
        InstallCommand = new RelayCommand(StartInstall, () => Validation is null);
        Validate();
    }

    public string Title => "Installation options";
    public string Directory
    {
        get => _directory;
        set { if (Set(ref _directory, value)) { Validate(); OnPropertyChanged(nameof(IsDefaultDirectory)); } }
    }
    public bool IsDefaultDirectory
    {
        get
        {
            try { return string.Equals(Path.GetFullPath(_directory.Length == 0 ? "." : _directory).TrimEnd('\\'), Product.DefaultInstallDirectory, StringComparison.OrdinalIgnoreCase); }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return false; }
        }
    }
    public bool DesktopShortcut { get => _desktop; set => Set(ref _desktop, value); }
    public bool StartMenuShortcut { get => _startMenu; set => Set(ref _startMenu, value); }
    public string? Validation { get => _validation; private set { if (Set(ref _validation, value)) { OnPropertyChanged(nameof(HasValidation)); RelayCommand.Refresh(); } } }
    public bool HasValidation => Validation is not null;
    public string ScopeNote => "Installs for the current user only. No administrator rights are required.";

    public RelayCommand BackCommand { get; }
    public RelayCommand BrowseCommand { get; }
    public RelayCommand ResetCommand { get; }
    public RelayCommand InstallCommand { get; }

    private void Validate() => Validation = InstallationState.ValidateDirectory(_directory);

    private void Browse()
    {
        var dlg = new OpenFolderDialog
        {
            Title = "Choose the GetANNY installation folder",
            Multiselect = false,
            InitialDirectory = System.IO.Directory.Exists(_directory) ? _directory : (SafeParent(_directory) ?? string.Empty),
        };
        if (dlg.ShowDialog(Application.Current.MainWindow) != true) return;
        var chosen = dlg.FolderName;
        // Mirror NSIS: if the user picks a generic folder, install into a product sub-folder.
        var leaf = Path.GetFileName(chosen.TrimEnd('\\'));
        Directory = leaf.Contains("GetANNY", StringComparison.OrdinalIgnoreCase) ? chosen : Path.Combine(chosen, Product.ProductName);
    }

    private static string? SafeParent(string path)
    {
        try { return Path.GetDirectoryName(path.TrimEnd('\\')); }
        catch (Exception ex) when (ex is ArgumentException or PathTooLongException) { return null; }
    }

    private void StartInstall()
    {
        if (Validation is not null) return;
        var options = new InstallOptions(Path.GetFullPath(_directory), DesktopShortcut, StartMenuShortcut,
            _shell.Args.Switches.Where(s => s.StartsWith("--", StringComparison.Ordinal) && !s.StartsWith("--mode=", StringComparison.Ordinal) && !s.StartsWith("--log=", StringComparison.Ordinal)).ToList());
        var service = new InstallService(_shell.Payload!);
        InstallOutcome? outcome = null;
        var progress = new ProgressViewModel(_shell, "Installing GetANNY", "This usually takes less than a minute.", InstallStages.All,
            async (p, ct) => outcome = await service.RunAsync(options, p, ct),
            () => _shell.Navigate(new CompleteViewModel(_shell, outcome!)));
        _shell.Navigate(progress);
        _ = progress.StartAsync();
    }
}

// ───────────────────────────── Installer · Screen 4 ─────────────────────────────

public sealed class CompleteViewModel : ObservableObject
{
    private readonly ShellViewModel _shell;
    private bool _launch = true;

    public CompleteViewModel(ShellViewModel shell, InstallOutcome outcome)
    {
        _shell = shell; Outcome = outcome;
        FinishCommand = new RelayCommand(Finish);
    }

    public InstallOutcome Outcome { get; }
    public string Title => Outcome.WasUpgrade ? "GetANNY is up to date" : "GetANNY is installed";
    public string Summary => $"Version {Product.Version} was installed to {Outcome.Directory}.";
    public bool LaunchApp { get => _launch; set => Set(ref _launch, value); }
    public RelayCommand FinishCommand { get; }

    private void Finish()
    {
        if (LaunchApp)
        {
            try { InstallService.LaunchApp(Outcome.ExecutablePath); }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or FileNotFoundException)
            {
                SetupLog.Error("launch failed", ex);
                MessageBox.Show(Application.Current.MainWindow!, "GetANNY could not be started: " + ex.Message, "GetANNY Setup", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
        _shell.Exit(0);
    }
}

// ───────────────────────────── Uninstaller · Screen 1 ─────────────────────────────

public sealed class UninstallConfirmViewModel : ObservableObject
{
    private readonly ShellViewModel _shell;
    private bool _removeData;

    /// <param name="previewDirectory">Only set by the --capture verification mode; bypasses registry lookup.</param>
    public UninstallConfirmViewModel(ShellViewModel shell, string? previewDirectory = null)
    {
        _shell = shell;
        InstallDirectory = previewDirectory ?? UninstallService.LocateInstallDirectory(shell.Args);
        Existing = InstallationState.FindExisting();
        CancelCommand = new RelayCommand(() => _shell.Exit(1));
        UninstallCommand = new RelayCommand(Start, () => InstallDirectory is not null);
    }

    public string Title => "Uninstall GetANNY?";
    public string? InstallDirectory { get; }
    public ExistingInstallation? Existing { get; }
    public string VersionLine => $"Version {Existing?.DisplayVersion ?? Product.Version}" + (InstallDirectory is null ? string.Empty : "  ·  " + InstallDirectory);
    public bool CanUninstall => InstallDirectory is not null;
    public string? LocateError => InstallDirectory is null ? "The GetANNY installation folder could not be found. It may already have been removed." : null;
    public bool RemoveAppData
    {
        get => _removeData;
        set
        {
            if (!Set(ref _removeData, value)) return;
            OnPropertyChanged(nameof(WillRemove));
            OnPropertyChanged(nameof(WillKeep));
        }
    }

    private static readonly string[] AppFilesToRemove =
    {
        "Application files in the installation folder",
        "Desktop and Start Menu shortcuts",
        "Browser native-messaging registrations owned by this install",
        "The Add/Remove Programs entry",
    };
    public IReadOnlyList<string> WillRemove => RemoveAppData
        ? AppFilesToRemove.Append("GetANNY history, settings, preferences and database").ToArray()
        : AppFilesToRemove;

    private static readonly string[] UserDataToKeep = new[]
    {
        "Download history", "Application settings and preferences", "Database files", "Downloaded files",
    };
    public IReadOnlyList<string> WillKeep => RemoveAppData ? new[] { "Downloaded files" } : UserDataToKeep;
    public string DataNote => "Removes %APPDATA%\\getanny and the legacy %APPDATA%\\GetANNY Download Manager profile. Downloaded files are never deleted.";

    public RelayCommand CancelCommand { get; }
    public RelayCommand UninstallCommand { get; }

    private void Start()
    {
        if (RemoveAppData)
        {
            var scope = $"\n\nThis deletes these GetANNY data folders and their contents:\n{Product.UserDataDirectory}\n{Product.ProductDataDirectory}\n\nDownloaded files and the selected installation folder are not included.";
            var answer = MessageBox.Show(Application.Current.MainWindow!,
                "Remove GetANNY's saved history, settings and database?" + scope,
                "Confirm GetANNY data removal", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
            if (answer != MessageBoxResult.Yes) return;
        }

        var options = new UninstallOptions(InstallDirectory!, RemoveAppData);
        var service = new UninstallService();
        var progress = new ProgressViewModel(_shell, "Uninstalling GetANNY", RemoveAppData ? "Application and its data are being removed." : "Your downloads, history and settings are kept.",
            UninstallStages.All,
            (p, ct) => service.RunInteractiveAsync(options, p, ct),
            () => _shell.Navigate(new UninstallCompleteViewModel(_shell, RemoveAppData)));
        _shell.Navigate(progress);
        _ = progress.StartAsync();
    }
}

// ───────────────────────────── Uninstaller · Screen 3 ─────────────────────────────

public sealed class UninstallCompleteViewModel : ObservableObject
{
    private readonly ShellViewModel _shell;

    public UninstallCompleteViewModel(ShellViewModel shell, bool dataRemoved)
    {
        _shell = shell; DataRemoved = dataRemoved;
        FinishCommand = new RelayCommand(() => _shell.Exit(0));
    }

    public bool DataRemoved { get; }
    public string Title => "GetANNY has been uninstalled.";
    public string Summary => DataRemoved
        ? "The application and its per-user data were removed."
        : "The application was removed. Your download history, settings and database were kept and will be picked up again if you reinstall.";
    public RelayCommand FinishCommand { get; }
}
