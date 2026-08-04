param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [string]$InstallDir = "",
    [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$SummaryPath = Join-Path $PSScriptRoot "installer-verify.log"
$Results = [System.Collections.Generic.List[string]]::new()
$Failures = 0
$Total = 0

function Write-Result([string]$name, [bool]$ok, [string]$detail = "") {
    $script:Total++
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    $line = "[$mark] $name"
    if ($detail) { $line += " | $detail" }
    $Results.Add($line)
    Write-Host $line
    if (-not $ok) { $script:Failures++ }
}

if (-not (Test-Path $InstallerPath)) {
    Write-Host "Installer not found: $InstallerPath" -ForegroundColor Red
    exit 1
}
if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\RootUp"
}

# Stop any running RootUp first (smoke/previous install may leave one)
Get-Process -Name "rootup" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

if (Test-Path $InstallDir) {
    Write-Host "Removing existing install dir: $InstallDir" -ForegroundColor Yellow
    Remove-Item $InstallDir -Recurse -Force
}

Write-Host "== RootUp installer verification =="
Write-Host "Installer: $InstallerPath"
Write-Host "Install dir: $InstallDir"

# 1. Silent install (NSIS: /S, /D= must be last, no quotes around path)
$installProc = Start-Process -FilePath $InstallerPath -ArgumentList "/S", "/D=$InstallDir" -Wait -PassThru
Write-Result "Silent install finished" ($installProc.ExitCode -eq 0) "exit=$($installProc.ExitCode)"

# 2. Verify installed exe and version
$exe = Join-Path $InstallDir "rootup.exe"
$exeExists = Test-Path $exe
Write-Result "Installed exe exists" $exeExists $exe
if ($exeExists) {
    $version = (Get-Item $exe).VersionInfo.ProductVersion
    $config = (Get-Content (Join-Path $Repo "src-tauri\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json)
    $expectedVersion = [string]$config.version
    $expectedBase = ($expectedVersion -split "-")[0]
    Write-Result "Installed version matches $expectedVersion" ($version -like "*$expectedBase*") "version=$version expected=$expectedVersion"
}

# 3. Smoke with the installed exe (full log-driven smoke)
if ($SkipSmoke) {
    Write-Result "Smoke skipped by flag" $true
} elseif ($exeExists) {
    & (Join-Path $Repo "scripts\smoke.ps1") -ExePath $exe
    Write-Result "Smoke with installed exe" ($LASTEXITCODE -eq 0) "exit=$LASTEXITCODE"
} else {
    Write-Result "Smoke skipped (exe missing)" $false
}

# Ensure the smoke instance is gone before uninstall
Get-Process -Name "rootup" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# 4. Silent uninstall
$uninstaller = Get-ChildItem $InstallDir -Filter "uninstall.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $uninstaller) {
    $uninstaller = Get-ChildItem $InstallDir -Filter "Uninstall *.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1
}
if ($uninstaller) {
    $uninstallProc = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
    Write-Result "Silent uninstall finished" ($uninstallProc.ExitCode -eq 0) "exit=$($uninstallProc.ExitCode)"
} else {
    Write-Result "Uninstaller found" $false $InstallDir
}

# 5. Verify cleanup (dir absent or empty)
Start-Sleep -Seconds 1
$clean =
    (-not (Test-Path $InstallDir)) -or
    ((Get-ChildItem $InstallDir -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0)
Write-Result "Install dir cleaned" $clean $InstallDir

$Results.Add("")
$Results.Add("Result: $Total checks, $Failures failed")
$Results | Set-Content -Path $SummaryPath -Encoding UTF8
Write-Host ""
Write-Host "Summary: $Total checks, $Failures failed"
Write-Host "Report: $SummaryPath"
exit $Failures
