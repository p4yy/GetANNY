using Microsoft.Win32;

namespace GetANNY.Setup.Core;

/// <summary>Snapshot of what the NSIS engine has registered for the current user.</summary>
public sealed record ExistingInstallation(
    string KeyName,
    string? DisplayName,
    string? DisplayVersion,
    string? InstallLocation,
    string? UninstallString,
    string? QuietUninstallString);

/// <summary>
/// Reads (never writes) the per-user Add/Remove Programs state produced by the
/// electron-builder NSIS engine. All registry writes are intentionally left to the
/// engine and to installer.nsh so there is exactly one owner of each key.
/// </summary>
public static class InstallationState
{
    private const string UninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    public static ExistingInstallation? FindExisting()
    {
        // 1. The GUID key electron-builder always uses.
        var direct = Read(Product.RegistryGuid);
        if (direct is not null) return direct;

        // 2. Defensive scan: an older build with a different guid option, same display name.
        try
        {
            using var root = Registry.CurrentUser.OpenSubKey(UninstallRoot);
            if (root is null) return null;
            foreach (var name in root.GetSubKeyNames())
            {
                var candidate = Read(name);
                if (candidate?.DisplayName is { } dn && dn.StartsWith(Product.ProductName, StringComparison.OrdinalIgnoreCase))
                    return candidate;
            }
        }
        catch (System.Security.SecurityException) { }
        return null;
    }

    public static ExistingInstallation? Read(string keyName)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(UninstallRoot + "\\" + keyName);
            if (key is null) return null;
            return new ExistingInstallation(
                keyName,
                key.GetValue("DisplayName") as string,
                key.GetValue("DisplayVersion") as string,
                (key.GetValue("InstallLocation") as string)?.Trim('"'),
                key.GetValue("UninstallString") as string,
                key.GetValue("QuietUninstallString") as string);
        }
        catch (System.Security.SecurityException) { return null; }
        catch (IOException) { return null; }
    }

    /// <summary>Count of HKCU uninstall entries that display as GetANNY — must be 0 or 1.</summary>
    public static int CountEntries()
    {
        try
        {
            using var root = Registry.CurrentUser.OpenSubKey(UninstallRoot);
            if (root is null) return 0;
            return root.GetSubKeyNames().Count(n =>
                Read(n)?.DisplayName is { } dn && dn.StartsWith(Product.ProductName, StringComparison.OrdinalIgnoreCase));
        }
        catch (System.Security.SecurityException) { return 0; }
    }

    public static bool UninstallKeyExists()
    {
        using var key = Registry.CurrentUser.OpenSubKey(Product.UninstallKeyPath);
        return key is not null;
    }

    /// <summary>Resolves the install directory: /D=, existing install, or default.</summary>
    public static string ResolveInstallDirectory(string? requested)
    {
        if (!string.IsNullOrWhiteSpace(requested)) return Path.GetFullPath(requested);
        var existing = FindExisting();
        if (existing?.InstallLocation is { Length: > 0 } loc && Directory.Exists(loc)) return loc;
        return Product.DefaultInstallDirectory;
    }

    /// <summary>Validates a user-entered destination the way the engine will see it.</summary>
    public static string? ValidateDirectory(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "Choose a destination folder.";
        if (path.IndexOfAny(Path.GetInvalidPathChars()) >= 0 || path.Contains('"')) return "The path contains invalid characters.";
        if (!Path.IsPathRooted(path)) return "Enter a full path, for example C:\\GetANNY.";
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(path));
            if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return "That drive is not available.";
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return "That path is not valid on this system.";
        }
        if (Path.GetFullPath(path).Length > 200) return "The path is too long for the installer (200 characters max).";
        return null;
    }
}
