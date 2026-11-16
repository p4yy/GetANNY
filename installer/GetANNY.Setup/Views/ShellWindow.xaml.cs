using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Input;
using System.Windows.Interop;
using GetANNY.Setup.Interop;
using GetANNY.Setup.ViewModels;

namespace GetANNY.Setup.Views;

public partial class ShellWindow : Window
{
    public ShellWindow()
    {
        InitializeComponent();
        SourceInitialized += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            NativeMethods.ApplyWindowChrome(hwnd);
        };
        Loaded += (_, _) =>
        {
            // Put keyboard focus on the first actionable control of the current page.
            MoveFocus(new TraversalRequest(FocusNavigationDirection.First));
            DataContextChanged += (_, _) => Dispatcher.BeginInvoke(() => MoveFocus(new TraversalRequest(FocusNavigationDirection.First)));
        };
        PageHost.TargetUpdated += (_, _) => Dispatcher.BeginInvoke(() =>
        {
            PageHost.MoveFocus(new TraversalRequest(FocusNavigationDirection.First));
            if (PageHost.Content is ProgressViewModel && UIElementAutomationPeer.FromElement(PageHost) is { } peer)
                peer.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
        });
        Closing += (_, e) =>
        {
            // Alt+F4 while the engine runs → route through the same confirmation as the close button.
            if (DataContext is ShellViewModel { IsBusy: true } vm)
            {
                e.Cancel = true;
                vm.TryClose();
            }
        };
    }

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState != MouseButtonState.Pressed) return;
        if (e.ClickCount == 2) return; // no maximize on a fixed-size dialog
        try { DragMove(); }
        catch (InvalidOperationException) { NativeMethods.BeginDrag(new WindowInteropHelper(this).Handle); }
    }
}
