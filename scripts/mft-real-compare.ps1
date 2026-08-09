param(
    [string]$Root = "C:\Users\Administrator\Desktop",
    [int]$Rounds = 1,
    [string]$OutFile = "benchmarks\mft-real-compare.md",
    [string]$SnapDir = ""
)

<#
  0.8.6 MFT real-directory validation (run as Administrator).
  For each round: walkdir scan -> DB snapshot; MFT scan -> DB snapshot;
  compare path/size/modified sets via scripts\mft_db_compare.py.
#>

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Repo "src-tauri\target\release\rootup.exe"
$AppData = Join-Path $env:APPDATA "com.rootup.desktop"
$SettingsPath = Join-Path $AppData "settings.json"
$Backup = "$SettingsPath.mftreal.bak"
$LogFile = Join-Path $env:LOCALAPPDATA "com.rootup.desktop\logs\rootup.log"
$DbPath = Join-Path $AppData "rootup.db"
if ($SnapDir -eq "") { $SnapDir = Join-Path $env:TEMP "rootup_mft_real_snapshots" }
$DbBackup = Join-Path $env:TEMP "rootup_mftreal_db_backup"
$Compare = Join-Path $PSScriptRoot "mft_db_compare.py"
$Report = Join-Path $Repo $OutFile

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges are required (MFT raw read)."
}
if (-not (Test-Path $Exe)) {
    Write-Error "Build release first: npm run tauri build -- --no-bundle"
}

function Get-LongPath([string]$path) {
    $memberDef = '[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile); [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint GetFinalPathNameByHandle(IntPtr hFile, System.Text.StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr hObject);'
    try {
        Add-Type -Namespace RootUp.Tools -Name LongPath -MemberDefinition $memberDef -ErrorAction Stop
    } catch {
    }
    $h = [RootUp.Tools.LongPath]::CreateFileW($path, 0x80, 0x1 -bor 0x2, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
    if ($h -eq [IntPtr]::Zero -or $h -eq [IntPtr](-1)) { return $path }
    try {
        $sb = New-Object System.Text.StringBuilder 32768
        $len = [RootUp.Tools.LongPath]::GetFinalPathNameByHandle($h, $sb, $sb.Capacity, 0)
        if ($len -eq 0 -or $len -gt $sb.Capacity) { return $path }
        $final = $sb.ToString(0, [int]$len)
        if ($final.StartsWith('\\?\')) { $final = $final.Substring(4) }
        return $final
    } finally {
        [RootUp.Tools.LongPath]::CloseHandle($h) | Out-Null
    }
}

function Invoke-OneScan([string]$dir, [bool]$mft) {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    $settings = @{
        settings = @{
            theme = "system"
            language = "zh-CN"
            watched_dirs = @($dir.Replace("\", "/"))
            ignore_rules = @{ extensions = @(); prefixes = @(); exact_names = @() }
            classify_overrides = @()
        }
    } | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($SettingsPath, $settings, (New-Object System.Text.UTF8Encoding($false)))
    Remove-Item $LogFile -Force -ErrorAction SilentlyContinue
    if ($mft) { $env:ROOTUP_MFT_SCAN = "1" } else { Remove-Item Env:ROOTUP_MFT_SCAN -ErrorAction SilentlyContinue }
    Start-Process -FilePath $Exe | Out-Null
    $deadline = (Get-Date).AddSeconds(300)
    $line = ""
    $leaf = Split-Path -Leaf $dir
    $pattern = "scan: .*" + [regex]::Escape($leaf) + ".*discovered="
    while ((Get-Date) -lt $deadline -and -not $line) {
        Start-Sleep -Milliseconds 200
        if (Test-Path $LogFile) {
            $m = Get-Content $LogFile -Tail 200 -ErrorAction SilentlyContinue | Select-String -Pattern $pattern | Select-Object -Last 1
            if ($m) { $line = $m.Line }
        }
    }
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $line) { return $null }
    return [pscustomobject]@{
        discovered = [int]($line -replace '.*discovered=(\d+).*', '$1')
        errors = [int]($line -replace '.*errors=(\d+).*', '$1')
        elapsed = [double]($line -replace '.*elapsed_ms=(\d+).*', '$1')
        dbMs = [double]($line -replace '.*db_ms=(\d+).*', '$1')
    }
}

function Copy-DbSnapshot([string]$destDir) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    foreach ($suffix in @("", "-wal", "-shm")) {
        $src = Join-Path $AppData ("rootup.db" + $suffix)
        if (Test-Path $src) { Copy-Item $src (Join-Path $destDir ("rootup.db" + $suffix)) -Force }
    }
}

if (Test-Path $SettingsPath) { Copy-Item $SettingsPath $Backup -Force }
Remove-Item $DbBackup -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $DbPath) {
    New-Item -ItemType Directory -Path $DbBackup | Out-Null
    foreach ($suffix in @("", "-wal", "-shm")) {
        $src = Join-Path $AppData ("rootup.db" + $suffix)
        if (Test-Path $src) { Copy-Item $src (Join-Path $DbBackup ("rootup.db" + $suffix)) -Force }
    }
}
Remove-Item $SnapDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $SnapDir | Out-Null

try {
    $rootLong = Get-LongPath $Root
    $ubr = try { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name UBR).UBR } catch { '?' }
    $reportLines = [System.Collections.Generic.List[string]]::new()
    $reportLines.Add("# MFT real-dir consistency validation")
    $reportLines.Add("")
    $reportLines.Add("- Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $reportLines.Add("- Host: $([Environment]::OSVersion.VersionString) (UBR $ubr)")
    $reportLines.Add("- Root: $rootLong")
    $reportLines.Add("- Rounds: $Rounds")
    $reportLines.Add("")
    $reportLines.Add("| round | walk files | mft files | walk-only | mft-only | size diff | time diff | ratio | verdict |")
    $reportLines.Add("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    [System.IO.File]::WriteAllLines($Report, $reportLines, (New-Object System.Text.UTF8Encoding($false)))

    $allOk = $true
    for ($r = 1; $r -le $Rounds; $r++) {
        foreach ($suffix in @("", "-wal", "-shm")) {
            Remove-Item (Join-Path $AppData ("rootup.db" + $suffix)) -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[mft-real] round $r walkdir..."
        $w = Invoke-OneScan $rootLong $false
        Copy-DbSnapshot (Join-Path $SnapDir ("walk_" + $r))
        foreach ($suffix in @("", "-wal", "-shm")) {
            Remove-Item (Join-Path $AppData ("rootup.db" + $suffix)) -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[mft-real] round $r MFT..."
        $m = Invoke-OneScan $rootLong $true
        Copy-DbSnapshot (Join-Path $SnapDir ("mft_" + $r))
        if (-not $w -or -not $m) {
            Write-Host "[mft-real] round $r scan failed or timed out"
            $allOk = $false
            continue
        }
        $label = "round $r"
        & python $Compare (Join-Path $SnapDir ("walk_" + $r + "\rootup.db")) (Join-Path $SnapDir ("mft_" + $r + "\rootup.db")) $rootLong $Report $label
        if ($LASTEXITCODE -ne 0) { $allOk = $false }
        Write-Host ("[mft-real] round {0} walk={1}ms db={2}ms mft={3}ms db={4}ms discovered {5}/{6} errors {7}/{8}" -f `
            $r, $w.elapsed, $w.dbMs, $m.elapsed, $m.dbMs, $w.discovered, $m.discovered, $w.errors, $m.errors)
    }
    Write-Host "Report: $Report"
    if ($allOk) { Write-Host "RESULT: PASS" } else { Write-Host "RESULT: FAIL" }
} finally {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_MFT_SCAN -ErrorAction SilentlyContinue
    if (Test-Path $Backup) { Move-Item $Backup $SettingsPath -Force } else { Remove-Item $SettingsPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $DbBackup) {
        foreach ($suffix in @("", "-wal", "-shm")) {
            $src = Join-Path $DbBackup ("rootup.db" + $suffix)
            if (Test-Path $src) { Copy-Item $src (Join-Path $AppData ("rootup.db" + $suffix)) -Force }
        }
        Remove-Item $DbBackup -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "cleanup done"
}
