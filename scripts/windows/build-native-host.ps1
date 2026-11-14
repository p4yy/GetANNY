$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) { throw '.NET Framework C# compiler is required to build the native-host launcher.' }
New-Item (Join-Path $root 'bin') -ItemType Directory -Force | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.+-]+)?$') {
    throw 'Invalid package version for the GetANNY Browser Bridge.'
}
$fileVersion = "$($Matches[1]).0"
$metadata = [IO.Path]::Combine([IO.Path]::GetTempPath(), "GetANNY-BrowserBridge-$([guid]::NewGuid()).cs")
try {
    @"
using System.Reflection;
[assembly: AssemblyTitle("GetANNY Browser Bridge")]
[assembly: AssemblyDescription("Connects the GetANNY browser extension to the desktop app")]
[assembly: AssemblyProduct("GetANNY")]
[assembly: AssemblyCompany("GetANNY Team")]
[assembly: AssemblyVersion("$fileVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Set-Content -LiteralPath $metadata -Encoding UTF8
    & $compiler /nologo /target:exe /platform:anycpu /optimize+ /reference:System.Web.Extensions.dll "/win32icon:$root\assets\icon.ico" "/out:$root\bin\GetANNY.NativeHost.exe" "$PSScriptRoot\NativeHost.cs" $metadata
    if ($LASTEXITCODE -ne 0) { throw 'GetANNY Browser Bridge compilation failed.' }
    $identity = (Get-Item -LiteralPath (Join-Path $root 'bin/GetANNY.NativeHost.exe')).VersionInfo
    if ($identity.FileDescription -ne 'GetANNY Browser Bridge' -or
        $identity.ProductName -ne 'GetANNY' -or
        $identity.CompanyName -ne 'GetANNY Team' -or
        $identity.ProductVersion -ne $version) {
        throw 'GetANNY Browser Bridge executable metadata did not match the app.'
    }
} finally {
    Remove-Item -LiteralPath $metadata -Force -ErrorAction SilentlyContinue
}
