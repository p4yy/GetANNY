using System.Diagnostics;
using System.Text;

namespace GetANNY.Setup.Core;

/// <summary>
/// Minimal append-only log. Default location: %LOCALAPPDATA%\GetANNY Download Manager\setup-logs\.
/// Tests pass --log= to collect logs as CI evidence.
/// </summary>
public static class SetupLog
{
    private static readonly object Gate = new();
    private static string? _path;

    public static string Path => _path ?? Initialise(null);

    public static string Initialise(string? explicitPath)
    {
        lock (Gate)
        {
            if (_path is not null && explicitPath is null) return _path;
            try
            {
                var p = explicitPath;
                if (string.IsNullOrWhiteSpace(p))
                {
                    var dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product.ProductName, "setup-logs");
                    Directory.CreateDirectory(dir);
                    p = System.IO.Path.Combine(dir, $"setup-{DateTime.Now:yyyyMMdd-HHmmss}-{Environment.ProcessId}.log");
                }
                else
                {
                    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(p))!);
                }
                _path = p;
                File.AppendAllText(_path, $"# GetANNY Setup {Product.Version} — {DateTime.Now:O}{Environment.NewLine}", Encoding.UTF8);
            }
            catch (Exception)
            {
                _path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"getanny-setup-{Environment.ProcessId}.log");
            }
            return _path;
        }
    }

    public static void Info(string message) => Write("INFO", message);
    public static void Warn(string message) => Write("WARN", message);
    public static void Error(string message, Exception? ex = null) => Write("ERROR", ex is null ? message : $"{message}{Environment.NewLine}{ex}");

    private static void Write(string level, string message)
    {
        var line = $"{DateTime.Now:HH:mm:ss.fff} [{level}] {message}{Environment.NewLine}";
        Debug.Write(line);
        lock (Gate)
        {
            try { File.AppendAllText(Path, line, Encoding.UTF8); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}
