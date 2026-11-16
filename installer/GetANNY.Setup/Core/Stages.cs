namespace GetANNY.Setup.Core;

public enum StageState { Pending, Active, Done, Skipped, Failed }

/// <summary>A unit of work shown as a row in the progress list.</summary>
public sealed record StageDefinition(string Id, string Title);

/// <summary>Status pushed from a service to the UI. Determinate fractions are only
/// ever reported for stages the shell itself performs byte-by-byte (payload extraction);
/// everything the NSIS engine does is reported as indeterminate with observed checkpoints.</summary>
public sealed record StageUpdate(string StageId, StageState State, string? Detail = null, double? Fraction = null);

public sealed class OperationFailedException : Exception
{
    public OperationFailedException(string message) : base(message) { }
    public OperationFailedException(string message, Exception inner) : base(message, inner) { }
}

public static class InstallStages
{
    public const string Prepare = "prepare";
    public const string Detect = "detect";
    public const string Files = "files";
    public const string Register = "register";
    public const string Shortcuts = "shortcuts";
    public const string Browser = "browser";
    public const string Finish = "finish";

    public static IReadOnlyList<StageDefinition> All { get; } = new[]
    {
        new StageDefinition(Prepare, "Preparing setup"),
        new StageDefinition(Detect, "Checking for an existing installation"),
        new StageDefinition(Files, "Installing application files"),
        new StageDefinition(Register, "Registering application"),
        new StageDefinition(Shortcuts, "Creating shortcuts"),
        new StageDefinition(Browser, "Provisioning browser integration"),
        new StageDefinition(Finish, "Finishing"),
    };
}

public static class UninstallStages
{
    public const string Close = "close";
    public const string Browser = "browser";
    public const string Files = "files";
    public const string Shortcuts = "shortcuts";
    public const string Registry = "registry";
    public const string Data = "data";
    public const string Finish = "finish";

    public static IReadOnlyList<StageDefinition> All { get; } = new[]
    {
        new StageDefinition(Close, "Closing GetANNY"),
        new StageDefinition(Browser, "Removing browser integration"),
        new StageDefinition(Files, "Removing application files"),
        new StageDefinition(Shortcuts, "Cleaning shortcuts"),
        new StageDefinition(Registry, "Cleaning registry entries"),
        new StageDefinition(Data, "Removing application data"),
        new StageDefinition(Finish, "Completing uninstallation"),
    };
}
