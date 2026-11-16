using System.Text;

namespace GetANNY.Setup.Core;

/// <summary>
/// Parses the raw Win32 command line the way NSIS does.
///
/// NSIS has two "greedy" switches whose value is the *remainder* of the command
/// line, unquoted, spaces included:
///   /D=C:\Program Files\App      (installer: target directory)
///   _?=C:\Program Files\App      (uninstaller: directory to operate on)
/// A tokenised <c>string[] args</c> would split those on spaces, so this parser
/// works on <see cref="Environment.CommandLine"/> instead and preserves every
/// other switch verbatim so it can be forwarded to the NSIS engine unchanged.
/// </summary>
public sealed class CommandLine
{
    private CommandLine() { }

    /// <summary>Tokens that are not /D= or _?= (quotes stripped).</summary>
    public IReadOnlyList<string> Switches { get; private set; } = Array.Empty<string>();

    /// <summary>Value of /D= (installer) if present.</summary>
    public string? TargetDirectory { get; private set; }

    /// <summary>Value of _?= (uninstaller) if present.</summary>
    public string? UninstallDirectory { get; private set; }

    public bool IsSilent => Has("/S");
    public bool IsUpdated => Has("--updated");
    public bool IsForceRun => Has("--force-run");
    public bool IsDeleteAppData => Has("--delete-app-data");
    public bool IsKeepShortcuts => Has("--keep-shortcuts");
    public bool IsNoDesktopShortcut => Has("--no-desktop-shortcut");
    public bool IsNoStartMenuShortcut => Has("--no-start-menu-shortcut");
    public bool IsAllUsers => Has("/allusers");
    public bool IsCurrentUser => Has("/currentuser");
    public bool IsHelp => Has("/?") || Has("--help") || Has("-h");

    /// <summary>Explicit role override used by tests: --mode=install | --mode=uninstall.</summary>
    public string? Mode => ValueOf("--mode=");

    /// <summary>Optional log file: --log="C:\path\setup.log".</summary>
    public string? LogPath => ValueOf("--log=");

    /// <summary>UI verification mode: --capture "dir" or --capture="dir" renders every page at 4 DPI scales.</summary>
    public string? CapturePath
    {
        get
        {
            var inline = ValueOf("--capture=");
            if (inline is not null) return inline;
            for (var i = 0; i < Switches.Count - 1; i++)
                if (Switches[i].Equals("--capture", StringComparison.OrdinalIgnoreCase)) return Switches[i + 1];
            return null;
        }
    }

    public bool Has(string sw) => Switches.Any(s => string.Equals(s, sw, StringComparison.OrdinalIgnoreCase));

    public string? ValueOf(string prefix)
    {
        var hit = Switches.FirstOrDefault(s => s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        return hit?[prefix.Length..].Trim('"');
    }

    public static CommandLine Parse(string rawCommandLine)
    {
        var cl = new CommandLine();
        var remainder = StripExecutable(rawCommandLine);

        // Greedy suffix switches. NSIS requires them to be last; we honour the
        // first occurrence and treat everything after it as the value.
        foreach (var (prefix, isInstall) in new[] { ("/D=", true), ("_?=", false) })
        {
            var idx = FindGreedySwitch(remainder, prefix);
            if (idx < 0) continue;

            var value = remainder[(idx + prefix.Length)..].Trim().Trim('"').TrimEnd('\\', ' ');
            remainder = remainder[..idx];
            if (isInstall) cl.TargetDirectory = value.Length == 0 ? null : value;
            else cl.UninstallDirectory = value.Length == 0 ? null : value;
        }

        cl.Switches = Tokenise(remainder);
        return cl;
    }

    /// <summary>
    /// Rebuilds a command line for the NSIS engine: every switch verbatim, then the
    /// greedy directory switch last and unquoted (as NSIS requires).
    /// </summary>
    public static string BuildEngineArguments(IEnumerable<string> switches, string? directorySwitch, string? directory)
    {
        var sb = new StringBuilder();
        foreach (var s in switches)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(QuoteIfNeeded(s));
        }
        if (directorySwitch is not null && !string.IsNullOrWhiteSpace(directory))
        {
            if (sb.Length > 0) sb.Append(' ');
            var fullDirectory = Path.GetFullPath(directory);
            var root = Path.GetPathRoot(fullDirectory);
            if (!string.Equals(fullDirectory, root, StringComparison.OrdinalIgnoreCase))
                fullDirectory = fullDirectory.TrimEnd('\\', '/');
            sb.Append(directorySwitch).Append(fullDirectory);
        }
        return sb.ToString();
    }

    public static string QuoteIfNeeded(string token)
    {
        if (token.Length == 0) return "\"\"";
        var eq = token.IndexOf('=');
        if (eq > 0 && token.Contains(' ') && !token.Contains('"'))
            return token[..(eq + 1)] + '"' + token[(eq + 1)..] + '"';
        return token.Contains(' ') && !token.StartsWith('"') ? '"' + token + '"' : token;
    }

    /// <summary>Finds a greedy switch at the start of the string or after whitespace.</summary>
    private static int FindGreedySwitch(string s, string prefix)
    {
        var from = 0;
        while (from < s.Length)
        {
            var idx = s.IndexOf(prefix, from, StringComparison.OrdinalIgnoreCase);
            if (idx < 0) return -1;
            if (idx == 0 || char.IsWhiteSpace(s[idx - 1])) return idx;
            from = idx + prefix.Length;
        }
        return -1;
    }

    private static string StripExecutable(string raw)
    {
        raw = raw.TrimStart();
        if (raw.Length == 0) return raw;
        if (raw[0] == '"')
        {
            var close = raw.IndexOf('"', 1);
            return close < 0 ? string.Empty : raw[(close + 1)..];
        }
        var space = raw.IndexOf(' ');
        return space < 0 ? string.Empty : raw[space..];
    }

    private static List<string> Tokenise(string s)
    {
        var tokens = new List<string>();
        var sb = new StringBuilder();
        var inQuotes = false;
        foreach (var ch in s)
        {
            if (ch == '"') { inQuotes = !inQuotes; continue; }
            if (char.IsWhiteSpace(ch) && !inQuotes)
            {
                if (sb.Length > 0) { tokens.Add(sb.ToString()); sb.Clear(); }
                continue;
            }
            sb.Append(ch);
        }
        if (sb.Length > 0) tokens.Add(sb.ToString());
        return tokens;
    }
}
