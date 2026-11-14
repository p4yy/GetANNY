const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execute = promisify(execFile);
const settingKeys = new Set([
  "scheduleEnabled",
  "scheduleWakeEnabled",
  "scheduleStartMinute",
  "scheduleEndMinute",
]);

// An interactive, least-privilege task launches GetANNY in the same Windows
// profile that owns its database. SIDs keep tasks separate between users.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$name = 'GetANNY Scheduled Downloads ' + $identity.User.Value
$service = New-Object -ComObject Schedule.Service
$service.Connect()
$folder = $service.GetFolder('\')
if ([string]::IsNullOrEmpty($env:GETANNY_WAKE_START)) {
  foreach ($registered in $folder.GetTasks(1)) {
    if ($registered.Name -eq $name) { $folder.DeleteTask($name, 0); break }
  }
  return
}
$task = $service.NewTask(0)
$task.RegistrationInfo.Description = 'Wake this PC and start GetANNY during the scheduled download window.'
$task.Principal.UserId = $identity.User.Value
$task.Principal.LogonType = 3
$task.Settings.WakeToRun = $true
$task.Settings.DisallowStartIfOnBatteries = $false
$task.Settings.StopIfGoingOnBatteries = $false
$task.Settings.ExecutionTimeLimit = 'PT0S'
$trigger = $task.Triggers.Create(2)
$trigger.DaysInterval = 1
$minute = [int]$env:GETANNY_WAKE_START
$start = [datetime]::Today.AddMinutes($minute)
$trigger.StartBoundary = $start.ToString('yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
$action = $task.Actions.Create(0)
$action.Path = $env:GETANNY_WAKE_EXECUTABLE
$action.Arguments = '--scheduled-downloads'
$folder.RegisterTaskDefinition($name, $task, 6, $identity.User.Value, $null, 3, $null) | Out-Null
`;

const command = [
  "-NoProfile",
  "-NonInteractive",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
];

class WindowsWakeSchedule {
  constructor({ executable, run = execute }) {
    this.executable = executable;
    this.run = run;
    this.lastApplied = undefined;
    this.pending = Promise.resolve();
  }

  configure(settings) {
    const minute =
      settings.scheduleEnabled &&
      settings.scheduleWakeEnabled &&
      settings.scheduleStartMinute !== settings.scheduleEndMinute
        ? settings.scheduleStartMinute
        : null;
    const operation = this.pending
      .catch(() => {})
      .then(async () => {
        if (minute === this.lastApplied) return;
        await this.run("powershell.exe", command, {
          env: {
            ...process.env,
            GETANNY_WAKE_START: minute === null ? "" : String(minute),
            GETANNY_WAKE_EXECUTABLE: this.executable,
          },
          windowsHide: true,
          timeout: 15000,
        });
        this.lastApplied = minute;
      });
    this.pending = operation;
    return operation;
  }

  remove() {
    return this.configure({});
  }
}

module.exports = { WindowsWakeSchedule, settingKeys };
