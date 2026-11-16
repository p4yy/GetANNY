using System.Windows;
using GetANNY.Setup.Core;
using GetANNY.Setup.Mvvm;

namespace GetANNY.Setup.ViewModels;

/// <summary>
/// Owns the frameless window chrome state and page navigation. One instance per
/// process; pages are created lazily and own their own commands.
/// </summary>
public sealed class ShellViewModel : ObservableObject
{
    private readonly CommandLine _args;
    private readonly Payload? _payload;
    private ObservableObject _currentPage = null!;
    private bool _busy;

    public event Action<int>? RequestClose;

    public ShellViewModel(SetupRole role, CommandLine args, Payload? payload)
    {
        Role = role; _args = args; _payload = payload;
        CloseCommand = new RelayCommand(TryClose);
        MinimizeCommand = new RelayCommand(() => { if (Application.Current.MainWindow is { } w) w.WindowState = WindowState.Minimized; });

        CurrentPage = role == SetupRole.Installer
            ? new WelcomeViewModel(this)
            : new UninstallConfirmViewModel(this);
    }

    public SetupRole Role { get; }
    public string WindowTitle => Role == SetupRole.Installer ? "GetANNY Setup" : "GetANNY Uninstall";
    public string WindowCaption => Role == SetupRole.Installer ? "Setup" : "Uninstall";
    public string Version => Product.Version;
    public CommandLine Args => _args;
    public Payload? Payload => _payload;

    public RelayCommand CloseCommand { get; }
    public RelayCommand MinimizeCommand { get; }

    public ObservableObject CurrentPage
    {
        get => _currentPage;
        private set => Set(ref _currentPage, value);
    }

    /// <summary>True while the engine runs; closing then requires confirmation.</summary>
    public bool IsBusy
    {
        get => _busy;
        set => Set(ref _busy, value);
    }

    public void Navigate(ObservableObject page) => CurrentPage = page;

    public void Exit(int code = 0) => RequestClose?.Invoke(code);

    /// <summary>Escape / close button / Alt+F4 all route here.</summary>
    public void TryClose()
    {
        if (CurrentPage is ProgressViewModel { IsRunning: true } progress)
        {
            var verb = Role == SetupRole.Installer ? "Installation" : "Uninstallation";
            var r = MessageBox.Show(Application.Current.MainWindow!,
                $"{verb} is still in progress. If you cancel now, GetANNY will be returned to its previous state once the current step finishes.\n\nCancel {verb.ToLowerInvariant()}?",
                WindowTitle, MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
            if (r == MessageBoxResult.Yes) progress.Cancel();
            return;
        }
        Exit(CurrentPage is CompleteViewModel or UninstallCompleteViewModel ? 0 : 1);
    }
}
