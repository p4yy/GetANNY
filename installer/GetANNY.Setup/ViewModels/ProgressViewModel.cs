using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Threading;
using GetANNY.Setup.Core;
using GetANNY.Setup.Mvvm;

namespace GetANNY.Setup.ViewModels;

public sealed class StageItemViewModel : ObservableObject
{
    private StageState _state;
    private string? _detail;

    public StageItemViewModel(StageDefinition def) { Id = def.Id; Title = def.Title; }

    public string Id { get; }
    public string Title { get; }
    public StageState State { get => _state; set { if (Set(ref _state, value)) { OnPropertyChanged(nameof(IsActive)); OnPropertyChanged(nameof(IsDone)); OnPropertyChanged(nameof(IsPending)); OnPropertyChanged(nameof(IsFailed)); OnPropertyChanged(nameof(IsSkipped)); OnPropertyChanged(nameof(AccessibleText)); } } }
    public string? Detail { get => _detail; set { if (Set(ref _detail, value)) OnPropertyChanged(nameof(AccessibleText)); } }

    public bool IsActive => State == StageState.Active;
    public bool IsDone => State == StageState.Done;
    public bool IsPending => State == StageState.Pending;
    public bool IsFailed => State == StageState.Failed;
    public bool IsSkipped => State == StageState.Skipped;
    public string AccessibleText => $"{Title}: {State}{(Detail is null ? string.Empty : ", " + Detail)}";
}

/// <summary>
/// Shared by installer and uninstaller. Runs the supplied operation on a background
/// task, projects StageUpdate messages onto the stage list, and never invents a
/// percentage: <see cref="IsIndeterminate"/> is true unless the active stage reports
/// a measured fraction (only payload extraction does).
/// </summary>
public sealed class ProgressViewModel : ObservableObject
{
    private readonly ShellViewModel _shell;
    private readonly Func<IProgress<StageUpdate>, CancellationToken, Task> _operation;
    private readonly Action _onSuccess;
    private readonly CancellationTokenSource _cts = new();
    private readonly DispatcherTimer _fileProgressTimer;
    private readonly bool _isInstallerFlow;
    private Stopwatch? _fileProgressWatch;
    private string _status = "Starting…";
    private string? _error;
    private bool _running = true;
    private bool _indeterminate = true;
    private bool _cancelRequested;
    private double _fraction;

    public ProgressViewModel(ShellViewModel shell, string title, string subtitle, IEnumerable<StageDefinition> stages,
        Func<IProgress<StageUpdate>, CancellationToken, Task> operation, Action onSuccess)
    {
        _shell = shell; _operation = operation; _onSuccess = onSuccess;
        Title = title; Subtitle = subtitle;
        Stages = new ObservableCollection<StageItemViewModel>(stages.Select(s => new StageItemViewModel(s)));
        _isInstallerFlow = Stages.Any(s => s.Id == InstallStages.Register);
        _fileProgressTimer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromSeconds(1),
        };
        _fileProgressTimer.Tick += (_, _) => OnPropertyChanged(nameof(StageCounter));
        CloseCommand = new RelayCommand(() => _shell.Exit(2), () => !IsRunning);
        OpenLogCommand = new RelayCommand(OpenLog);
    }

    public string Title { get; }
    public string Subtitle { get; }
    public bool IsUninstallerFlow => !_isInstallerFlow;
    public ObservableCollection<StageItemViewModel> Stages { get; }
    public RelayCommand CloseCommand { get; }
    public RelayCommand OpenLogCommand { get; }

    public string Status { get => _status; private set => Set(ref _status, value); }
    public string? Error { get => _error; private set { if (Set(ref _error, value)) OnPropertyChanged(nameof(HasError)); } }
    public bool HasError => Error is not null;
    public bool IsRunning { get => _running; private set { if (Set(ref _running, value)) RelayCommand.Refresh(); } }
    public bool IsIndeterminate { get => _indeterminate; private set => Set(ref _indeterminate, value); }
    public double Fraction { get => _fraction; private set => Set(ref _fraction, value); }
    public bool CancelRequested { get => _cancelRequested; private set => Set(ref _cancelRequested, value); }
    public int CompletedCount => Stages.Count(s => s.State is StageState.Done or StageState.Skipped);
    public int TotalCount => Stages.Count;
    public string StageCounter
    {
        get
        {
            var counter = $"{CompletedCount} of {TotalCount} steps";
            if (_fileProgressWatch is not { IsRunning: true } watch) return counter;
            var elapsed = watch.Elapsed;
            return $"{counter} · {(int)elapsed.TotalMinutes:00}:{elapsed.Seconds:00} elapsed";
        }
    }

    public void Cancel()
    {
        if (!IsRunning) return;
        CancelRequested = true;
        Status = "Cancelling… waiting for the current step to finish";
        _cts.Cancel();
    }

    public async Task StartAsync()
    {
        _shell.IsBusy = true;
        var progress = new Progress<StageUpdate>(Apply);
        try
        {
            await Task.Run(() => _operation(progress, _cts.Token));
            IsRunning = false;
            _shell.IsBusy = false;
            _onSuccess();
        }
        catch (OperationCanceledException)
        {
            Finish("Cancelled. No changes were kept.");
            _shell.Exit(1);
        }
        catch (OperationFailedException ex)
        {
            SetupLog.Error("operation failed: " + ex.Message);
            Finish(ex.Message);
        }
        catch (Exception ex)
        {
            SetupLog.Error("operation crashed", ex);
            Finish(ex.Message);
        }
    }

    private void Finish(string error)
    {
        StopFileProgressTimer();
        foreach (var s in Stages.Where(s => s.State == StageState.Active)) s.State = StageState.Failed;
        Error = error;
        Status = "Stopped";
        IsIndeterminate = false;
        IsRunning = false;
        _shell.IsBusy = false;
    }

    private void Apply(StageUpdate u)
    {
        if (_isInstallerFlow && u.StageId == InstallStages.Files)
        {
            if (u.State == StageState.Active) StartFileProgressTimer();
            else StopFileProgressTimer();
        }

        var stage = Stages.FirstOrDefault(s => s.Id == u.StageId);
        if (stage is null) return;
        stage.State = u.State;
        if (u.Detail is not null || u.State != StageState.Active) stage.Detail = u.Detail;

        if (u.State == StageState.Active && !CancelRequested)
            Status = u.Detail ?? stage.Title + "…";

        var active = Stages.FirstOrDefault(s => s.State == StageState.Active);
        if (active is not null && u.StageId == active.Id && u.Fraction is { } f)
        {
            IsIndeterminate = false;
            Fraction = f;
        }
        else if (active is not null && u.Fraction is null && u.StageId == active.Id)
        {
            IsIndeterminate = true;
        }
        OnPropertyChanged(nameof(CompletedCount));
        OnPropertyChanged(nameof(StageCounter));
    }

    private void StartFileProgressTimer()
    {
        if (_fileProgressWatch is not null) return;
        _fileProgressWatch = Stopwatch.StartNew();
        _fileProgressTimer.Start();
        OnPropertyChanged(nameof(StageCounter));
    }

    private void StopFileProgressTimer()
    {
        _fileProgressTimer.Stop();
        if (_fileProgressWatch is null) return;
        _fileProgressWatch.Stop();
        _fileProgressWatch = null;
        OnPropertyChanged(nameof(StageCounter));
    }

    /// <summary>Used only by the --capture verification mode to render a representative mid-run state.</summary>
    public void SeedPreview(string status, bool indeterminate, double fraction, params (string Id, StageState State, string? Detail)[] states)
    {
        foreach (var (id, state, detail) in states)
        {
            var s = Stages.FirstOrDefault(x => x.Id == id);
            if (s is null) continue;
            s.State = state; s.Detail = detail;
        }
        Status = status; IsIndeterminate = indeterminate; Fraction = fraction;
        OnPropertyChanged(nameof(CompletedCount)); OnPropertyChanged(nameof(StageCounter));
    }

    private void OpenLog()
    {
        try { Process.Start(new ProcessStartInfo(SetupLog.Path) { UseShellExecute = true }); }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            MessageBox.Show(Application.Current.MainWindow!, SetupLog.Path, "Setup log", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }
}
