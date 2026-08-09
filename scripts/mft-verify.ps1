param(
    [string]$Root = "",
    [switch]$Huge,
    [int]$Rounds = 3,
    [string]$OutFile = "benchmarks\mft-crossover.md"
)

<#
  0.8.6 MFT elevated validation & crossover experiment (run as Administrator).
  Consistency: MFT scan (ROOTUP_MFT_SCAN=1) vs walkdir must produce the same
  discovered count with errors=0 on the same corpus.
  Crossover: compare timing by corpus size to find the threshold where MFT wins.
  Usage (elevated PowerShell):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mft-verify.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mft-verify.ps1 -Root D:\real\folder -Huge
#>

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Repo "src-tauri\target\release\rootup.exe"
$AppData = Join-Path $env:APPDATA "com.rootup.desktop"
$SettingsPath = Join-Path $AppData "settings.json"
$Backup = "$SettingsPath.mftverify.bak"
$LogFile = Join-Path $env:LOCALAPPDATA "com.rootup.desktop\logs\rootup.log"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges are required (MFT raw read needs SeBackupPrivilege)."
}
if (-not (Test-Path $Exe)) {
    Write-Error "Build release first: npm run tauri build -- --no-bundle"
}

$sizes = @(1000, 10000, 50000)
if ($Huge) { $sizes += @(100000, 300000) }

function New-Corpus([string]$dir, [int]$count) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    for ($i = 0; $i -lt $count; $i++) {
        $sub = Join-Path $dir ("d" + ($i % 100).ToString("000"))
        New-Item -ItemType Directory -Force -Path $sub | Out-Null
        Set-Content -Path (Join-Path $sub ("f" + $i.ToString("000000") + ".txt")) -Value "x" -Encoding UTF8
    }
}

function Invoke-OneScan([string]$dir, [bool]$mft) {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
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
    $deadline = (Get-Date).AddSeconds(180)
    $line = ""
    while ((Get-Date) -lt $deadline -and -not $line) {
        Start-Sleep -Milliseconds 300
        if (Test-Path $LogFile) {
            $line = (Get-Content $LogFile -Raw | Select-String -Pattern "scan: .*dir=$($dir.Replace('\','/'))" | Select-Object -Last 1).Line
        }
    }
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $line) { return $null }
    return [pscustomobject]@{
        discovered = [int]($line -replace '.*discovered=(\d+).*', '$1')
        errors = [int]($line -replace '.*errors=(\d+).*', '$1')
        elapsed = [double]($line -replace '.*elapsed_ms=(\d+).*', '$1')
    }
}

function P50($values) {
    $sorted = @($values | Sort-Object)
    $sorted[[int]($sorted.Count / 2)]
}

if (Test-Path $SettingsPath) { Copy-Item $SettingsPath $Backup -Force }
try {
    $report = [System.Collections.Generic.List[string]]::new()
    $report.Add("# MFT/walkdir crossover experiment")
    $report.Add("")
    $report.Add("- Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $report.Add("- Host: $([Environment]::OSVersion.VersionString) (UBR $(try { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name UBR).UBR } catch { '?' }))")
    $report.Add("- Admin: $isAdmin")
    if ($Root -ne "") { $corpusDesc = "real dir $Root" } else { $corpusDesc = "generated" }
    $report.Add("- Corpus: $corpusDesc")
    $report.Add("")
    $report.Add("| size | walkdir p50 (ms) | MFT p50 (ms) | count match | errors | winner |")
    $report.Add("| --- | --- | --- | --- | --- | --- |")

    if ($Root) { $sizes = @(-1) }
    foreach ($size in $sizes) {
        $dir = if ($Root) { $Root } else { Join-Path $env:TEMP ("rootup_mft_corpus_" + $size) }
        if (-not $Root) {
            Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
            New-Corpus $dir $size
        }
        $walk = @(); $mft = @(); $countOk = $true
        for ($r = 0; $r -lt $Rounds; $r++) {
            $w = Invoke-OneScan $dir $false
            $m = Invoke-OneScan $dir $true
            if (-not $w -or -not $m) { $countOk = $false; break }
            if ($w.discovered -ne $m.discovered -or $w.errors -ne 0 -or $m.errors -ne 0) { $countOk = $false }
            $walk += $w.elapsed; $mft += $m.elapsed
        }
        $wp = P50 $walk; $mp = P50 $mft
        $label = if ($Root) { "real" } else { $size }
        $better = if ($countOk) { if ($mp -lt $wp) { "MFT" } elseif ($mp -gt $wp) { "walkdir" } else { "tie" } } else { "consistency failed" }
        $report.Add("| $label | $wp | $mp | $countOk | 0/0 | $better |")
        if (-not $Root) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    $threshold = if ($Root) { "inferred from the real-dir results" } else { "first size in the table where MFT wins; if even 50k does not win, mark MFT not recommended for this corpus" }
    $report.Add("")
    $report.Add("## Threshold and decision")
    $report.Add("- Suggested threshold: $threshold")
    $report.Add("- Decision rule: consistency OK and size >= threshold -> MFT first by default; otherwise keep walkdir.")
    $full = Join-Path $Repo $OutFile
    [System.IO.File]::WriteAllLines($full, $report, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Report: $full"
} finally {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_MFT_SCAN -ErrorAction SilentlyContinue
    if (Test-Path $Backup) { Move-Item $Backup $SettingsPath -Force } else { Remove-Item $SettingsPath -Force -ErrorAction SilentlyContinue }
}
