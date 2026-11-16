namespace GetANNY.Setup.Core;

/// <summary>
/// Locates the shell links the NSIS engine creates. The engine owns creation and
/// removal (CreateShortCut / WinShell::UninstShortcut); the shell only *observes*
/// them to report truthful stage status and to verify a clean uninstall.
/// </summary>
public static class Shortcuts
{
    /// <summary>electron-builder SHORTCUT_NAME = productName.</summary>
    public const string LinkFileName = Product.ProductName + ".lnk";

    public static string DesktopLink =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), LinkFileName);

    public static string StartMenuLink =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), LinkFileName);

    public static bool DesktopExists => File.Exists(DesktopLink);
    public static bool StartMenuExists => File.Exists(StartMenuLink);

    /// <summary>Any GetANNY link in the per-user Desktop / Programs folders (including renamed ones).</summary>
    public static IReadOnlyList<string> FindAll()
    {
        var hits = new List<string>();
        foreach (var dir in new[]
                 {
                     Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                     Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                 })
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
            try
            {
                hits.AddRange(Directory.EnumerateFiles(dir, "*GetANNY*.lnk", SearchOption.AllDirectories));
            }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }
        }
        return hits;
    }
}
