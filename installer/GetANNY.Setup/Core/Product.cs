using System.Diagnostics;
using System.Reflection;

namespace GetANNY.Setup.Core;

/// <summary>
/// Constants that must stay in lock-step with electron-builder.yml and package.json.
/// Everything that electron-builder derives (registry GUID, file names, default
/// directory) is reproduced here so the shell can locate what the NSIS engine wrote.
/// </summary>
public static class Product
{
    public const string AppId = "com.getanny.app";
    public const string ProductName = "GetANNY Download Manager";
    public const string ShortName = "GetANNY";
    public const string ExecutableName = "GetANNY.exe";
    public const string PackageName = "getanny";          // package.json "name" → %APPDATA%\getanny
    public const string Publisher = "GetANNY Team";
    public const string Tagline = "A fast, private download manager for files, video and audio.";

    /// <summary>electron-builder: "Uninstall ${PRODUCT_FILENAME}.exe".</summary>
    public const string EngineUninstallerFileName = "Uninstall GetANNY Download Manager.exe";

    /// <summary>The WPF shell copied by electron-builder (extraFiles) into the install root.</summary>
    public const string ShellUninstallerFileName = "GetANNY Uninstall.exe";

    /// <summary>Marker written by installer.nsh that enables the GitHub updater feed.</summary>
    public const string UpdateMarkerRelativePath = @"resources\getanny-github-updates";

    /// <summary>
    /// UUID v5(appId) in electron-builder's namespace 50e065bc-3134-11e6-9bab-38c9862bdaf3.
    /// electron-builder uses this GUID for both INSTALL_REGISTRY_KEY and UNINSTALL_REGISTRY_KEY.
    /// </summary>
    public static readonly string RegistryGuid = Uuid5.Create(new Guid("50e065bc-3134-11e6-9bab-38c9862bdaf3"), AppId).ToString("D");

    public static string UninstallKeyPath => @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + RegistryGuid;
    public static string InstallKeyPath => @"Software\" + RegistryGuid;

    /// <summary>Version baked in at build time from package.json (Directory.Build.props).</summary>
    public static string Version { get; } = ReadVersion();

    public static string DefaultInstallDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", ProductName);

    public static string UserDataDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), PackageName);

    public static string ProductDataDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), ProductName);

    private static string ReadVersion()
    {
        var asm = Assembly.GetExecutingAssembly();
        var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (!string.IsNullOrWhiteSpace(info))
        {
            var plus = info.IndexOf('+');
            return plus > 0 ? info[..plus] : info;
        }
        var processPath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "GetANNY.Setup.exe");
        var fv = FileVersionInfo.GetVersionInfo(processPath);
        return $"{fv.FileMajorPart}.{fv.FileMinorPart}.{fv.FileBuildPart}";
    }
}

/// <summary>RFC 4122 name-based UUID (version 5, SHA-1), matching Node's uuid.v5.</summary>
public static class Uuid5
{
    public static Guid Create(Guid ns, string name)
    {
        var nsBytes = ns.ToByteArray();
        SwapGuidByteOrder(nsBytes);
        var nameBytes = System.Text.Encoding.UTF8.GetBytes(name);
        var data = new byte[nsBytes.Length + nameBytes.Length];
        Buffer.BlockCopy(nsBytes, 0, data, 0, nsBytes.Length);
        Buffer.BlockCopy(nameBytes, 0, data, nsBytes.Length, nameBytes.Length);
        var hash = System.Security.Cryptography.SHA1.HashData(data);
        var g = new byte[16];
        Array.Copy(hash, 0, g, 0, 16);
        g[6] = (byte)((g[6] & 0x0F) | 0x50);
        g[8] = (byte)((g[8] & 0x3F) | 0x80);
        SwapGuidByteOrder(g);
        return new Guid(g);
    }

    private static void SwapGuidByteOrder(byte[] g)
    {
        (g[0], g[3]) = (g[3], g[0]);
        (g[1], g[2]) = (g[2], g[1]);
        (g[4], g[5]) = (g[5], g[4]);
        (g[6], g[7]) = (g[7], g[6]);
    }
}
