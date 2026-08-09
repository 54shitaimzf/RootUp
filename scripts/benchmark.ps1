param(
    [string]$ExePath = "src-tauri\target\release\rootup.exe",
    [int]$Rounds = 5,
    [string]$Version = "",
    [switch]$Full,
    [switch]$Huge,
    [switch]$DryRun,
    [switch]$DeterminismCheck,
    [string]$Shape = "mixed",
    [int]$IdleSeconds = 60,
    [string]$ResultsDir = "benchmarks\results"
)

# System-level benchmark v2 (custom harness): cold/warm startup, scan, memory
# series, idle CPU, IO bytes and bundle size. Backs up and restores the real
# settings + index DB. Local-only, same-machine comparison.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RootUpBenchIo {
  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GetProcessIoCounters(IntPtr hProcess, out IO_COUNTERS lpIoCounters);
}
"@

if (-not $Version) {
    $pkg = Get-Content (Join-Path $Repo "package.json") -Raw | ConvertFrom-Json
    $Version = $pkg.version
}
if ($DryRun) { $Rounds = 1; $IdleSeconds = 5 }

if (-not $DeterminismCheck) {
    $Exe = Join-Path $Repo $ExePath
    if (-not (Test-Path $Exe)) { throw "Release exe not found: $Exe" }
}

$FileCount = if ($DryRun) { 100 } elseif ($Huge) { 300000 } elseif ($Full) { 100000 } else { 10000 }
$AppData = Join-Path $env:APPDATA "com.rootup.desktop"
$SettingsPath = Join-Path $AppData "settings.json"
$DbPath = Join-Path $AppData "rootup.db"
$LogDir = Join-Path $env:LOCALAPPDATA "com.rootup.desktop\logs"
$LogFile = Join-Path $LogDir "rootup.log"
$SettingsBackup = "$SettingsPath.bench.bak"
$DbBackup = "$DbPath.bench.bak"
$FixtureRoot = Join-Path $env:TEMP ("rootup_bench_fixture_" + [guid]::NewGuid().ToString("N"))
$OutPath = Join-Path $Repo (Join-Path $ResultsDir "$Version.json")
if ($DryRun) {
    $OutPath = Join-Path $env:TEMP ("rootup_bench_dryrun_" + [guid]::NewGuid().ToString("N") + ".json")
}

$script:metrics = @{}

function Add-Sample([string]$Name, [double]$Value) {
    if ($null -eq $Value -or $Value -lt 0) { return }
    if (-not $script:metrics.ContainsKey($Name)) {
        $script:metrics[$Name] = [System.Collections.Generic.List[double]]::new()
    }
    $script:metrics[$Name].Add($Value)
}

function Wait-LogLine([string]$Pattern, [int]$TimeoutSeconds) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $LogFile) {
            $match = Select-String -Path $LogFile -Pattern $Pattern -SimpleMatch |
                Select-Object -Last 1
            if ($match) { return $watch.Elapsed.TotalMilliseconds }
        }
        Start-Sleep -Milliseconds 50
    }
    return -1
}

function Stop-RootUp {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

function Restore-UserData {
    Stop-RootUp
    Remove-Item $SettingsPath, $DbPath, "$DbPath-wal", "$DbPath-shm" -Force -ErrorAction SilentlyContinue
    if (Test-Path $SettingsBackup) { Move-Item $SettingsBackup $SettingsPath -Force }
    if (Test-Path $DbBackup) { Move-Item $DbBackup $DbPath -Force }
}

function Get-GzipKb([string]$Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $out = New-Object System.IO.MemoryStream
    $gzip = New-Object System.IO.Compression.GZipStream (
        $out,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $true
    )
    $gzip.Write($bytes, 0, $bytes.Length)
    $gzip.Dispose()
    $kb = $out.Length / 1KB
    $out.Dispose()
    return $kb
}

function Get-Corpus {
    $specPath = Join-Path $Repo "benchmarks\specs\corpus.json"
    if (-not (Test-Path $specPath)) { throw "Corpus spec not found: $specPath" }
    return (Get-Content $specPath -Raw | ConvertFrom-Json)
}

function New-FixtureFromSpec([string]$Root, [int]$Count, [string]$ShapeName) {
    $corpus = Get-Corpus
    $rng = [System.Random]::new([int]$corpus.seed + $Count)
    $extList = @()
    foreach ($prop in $corpus.extensions.PSObject.Properties) {
        for ($i = 0; $i -lt [int]$prop.Value; $i++) { $extList += $prop.Name }
    }
    $noise = @($corpus.noiseDirs)
    $dirs = @("docs", "images", "music", "code", "projects", "courses\math-advanced", "courses\physics", "downloads")
    for ($i = 0; $i -lt $Count; $i++) {
        $dir = switch ($ShapeName) {
            "wide" { Join-Path $Root ("d" + ($i % 100).ToString("D3")) }
            "deep" {
                $parts = @()
                $v = $i
                for ($d = 0; $d -lt 8; $d++) { $parts += "n" + ($v % 8); $v = [Math]::Floor($v / 8) }
                Join-Path $Root ($parts -join "\")
            }
            "noise" {
                if ($i % 5 -eq 0) {
                    Join-Path $Root ($noise[$rng.Next($noise.Count)] + "\pkg" + ($i % 20))
                } else {
                    Join-Path $Root $dirs[$i % $dirs.Count]
                }
            }
            default { Join-Path $Root $dirs[$i % $dirs.Count] }
        }
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $ext = $extList[$rng.Next($extList.Count)]
        $name = if ($rng.NextDouble() -lt [double]$corpus.unicodeNameRatio) {
            ([char]0x9AD8 + [char]0x7B49 + [char]0x6570 + [char]0x5B66 + "-" +
                (($i % 20) + 1) + "-notes-" + $i + "." + $ext)
        } else {
            ("file" + $i.ToString("D6") + "." + $ext)
        }
        $size = if ($rng.NextDouble() -lt 0.7) { $rng.Next(4096) }
        elseif ($rng.NextDouble() -lt 0.9) { 4096 + $rng.Next(28672) }
        else { 32768 + $rng.Next(32768) }
        [System.IO.File]::WriteAllBytes(
            (Join-Path $dir $name),
            (New-Object byte[] $size)
        )
    }
}

function Get-FixtureFingerprint([string]$Root) {
    $sb = New-Object System.Text.StringBuilder
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $files = Get-ChildItem $Root -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName
    foreach ($f in $files) {
        if ($f.FullName.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            $rel = $f.FullName.Substring($rootFull.Length).TrimStart('\', '/')
        } else {
            $rel = $f.FullName
        }
        [void]$sb.AppendLine("$rel|$($f.Length)")
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

if ($DeterminismCheck) {
    $checkCount = 200
    $checkRoot = Join-Path $env:TEMP ("rootup_bench_det_" + [guid]::NewGuid().ToString("N"))
    try {
        New-FixtureFromSpec $checkRoot $checkCount $Shape
        $hash1 = Get-FixtureFingerprint $checkRoot
        Get-ChildItem $checkRoot -Force | Remove-Item -Recurse -Force
        New-FixtureFromSpec $checkRoot $checkCount $Shape
        $hash2 = Get-FixtureFingerprint $checkRoot
        if ($hash1 -ne $hash2) {
            throw "Deterministic corpus check FAILED (same seed produced different fixtures)"
        }
        Write-Host "Deterministic corpus check PASS ($checkCount files, seed=$((Get-Corpus).seed))"
    } finally {
        Remove-Item $checkRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

function Get-ProcIO([System.Diagnostics.Process]$Proc) {
    try {
        if ($Proc.HasExited) { return $null }
        $c1 = New-Object RootUpBenchIo+IO_COUNTERS
        if (-not [RootUpBenchIo]::GetProcessIoCounters($Proc.Handle, [ref]$c1)) { return $null }
        Start-Sleep -Milliseconds 1000
        if ($Proc.HasExited) { return $null }
        $c2 = New-Object RootUpBenchIo+IO_COUNTERS
        if (-not [RootUpBenchIo]::GetProcessIoCounters($Proc.Handle, [ref]$c2)) { return $null }
        $read = [double]($c2.ReadTransferCount - $c1.ReadTransferCount)
        $write = [double]($c2.WriteTransferCount - $c1.WriteTransferCount)
        return @{ read = $read; write = $write }
    } catch {
        return $null
    }
}

function Summarize([double[]]$Values) {
    if ($Values.Count -eq 0) { return $null }
    $sorted = @($Values | Sort-Object)
    $n = $sorted.Count
    $pct = {
        param($p)
        $idx = [Math]::Min($n - 1, [Math]::Max(0, [Math]::Ceiling($n * $p) - 1))
        $sorted[$idx]
    }
    $mean = ($sorted | Measure-Object -Average).Average
    $variance = 0.0
    foreach ($v in $sorted) { $variance += ($v - $mean) * ($v - $mean) }
    $variance /= $n
    $p50 = & $pct 0.5
    $p90 = & $pct 0.9
    $p99 = & $pct 0.99
    return [ordered]@{
        p50 = [Math]::Round($p50, 3)
        p90 = [Math]::Round($p90, 3)
        p99 = [Math]::Round($p99, 3)
        min = [Math]::Round($sorted[0], 3)
        max = [Math]::Round($sorted[$n - 1], 3)
        mean = [Math]::Round($mean, 3)
        cv = if ([Math]::Abs($mean) -lt 1e-9) { 0.0 } else { [Math]::Round([Math]::Sqrt($variance) / $mean, 3) }
        samples = $n
    }
}

function Invoke-OneRound([bool]$FreshDb, [string]$Tag) {
    if ($FreshDb) {
        Remove-Item $LogFile, $DbPath, "$DbPath-wal", "$DbPath-shm" -Force -ErrorAction SilentlyContinue
    } else {
        Remove-Item $LogFile -Force -ErrorAction SilentlyContinue
    }
    $Proc = Start-Process -FilePath $Exe -PassThru

    $startupMs = Wait-LogLine "rootup_lib::app RootUp" 60
    Add-Sample ("system_startup_" + $Tag + "_ms") $startupMs
    $interactiveMs = Wait-LogLine "settings: " $(if ($DryRun) { 15 } else { 30 })
    Add-Sample ("system_interactive_" + $Tag + "_ms") $interactiveMs

    $peak = 0
    $scanLine = $null
    $memSeries = [System.Collections.Generic.List[double]]::new()
    $deadline = (Get-Date).AddSeconds(600)
    while ((Get-Date) -lt $deadline) {
        if ($Proc -and -not $Proc.HasExited) {
            $rss = $Proc.WorkingSet64
            if ($rss -gt $peak) { $peak = $rss }
            $memSeries.Add($rss / 1MB)
        }
        if (Test-Path $LogFile) {
            $m = Select-String -Path $LogFile -Pattern "elapsed_ms=" -SimpleMatch |
                Select-Object -Last 1
            if ($m) { $scanLine = $m.Line; break }
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $scanLine) { throw "Scan did not finish ($Tag)" }
    Add-Sample ("system_scan_" + $Tag + "_peak_rss_mb") ($peak / 1MB)
    if ($memSeries.Count -gt 0) {
        $arr = @($memSeries.ToArray())
        Add-Sample ("system_mem_series_" + $Tag + "_mean_mb") (($arr | Measure-Object -Average).Average)
        Add-Sample ("system_mem_series_" + $Tag + "_peak_mb") ($arr | Measure-Object -Maximum).Maximum
    }
    if ($scanLine -match "elapsed_ms=(\d+)") {
        Add-Sample ("system_scan_" + $Tag + "_ms") ([double]$Matches[1])
    }
    if ($scanLine -match "files_per_sec=([\d.]+)") {
        Add-Sample ("system_scan_" + $Tag + "_files_per_sec") ([double]$Matches[1])
    }
    $io = Get-ProcIO $Proc
    if ($io) {
        Add-Sample ("system_io_" + $Tag + "_read_mb_per_sec") ($io.read / 1MB)
        Add-Sample ("system_io_" + $Tag + "_write_mb_per_sec") ($io.write / 1MB)
    }
    $script:lastProc = $Proc
}

try {
    Stop-RootUp
    if (Test-Path $SettingsBackup) { Restore-UserData }

    if (Test-Path $SettingsPath) { Copy-Item $SettingsPath $SettingsBackup -Force }
    if (Test-Path $DbPath) { Copy-Item $DbPath $DbBackup -Force }

    New-FixtureFromSpec $FixtureRoot $FileCount $Shape
    $FixtureDir = $FixtureRoot.Replace("\", "/")
    $Settings = @{
        settings = @{
            theme = "system"
            language = "zh-CN"
            watched_dirs = @($FixtureDir)
            ignore_rules = @{
                extensions = @("crdownload", "part", "tmp")
                prefixes = @("~$")
                exact_names = @("desktop.ini", "thumbs.db", ".ds_store")
            }
            classify_overrides = @()
        }
    } | ConvertTo-Json -Depth 8
    New-Item -ItemType Directory -Path (Split-Path $SettingsPath) -Force | Out-Null
    [System.IO.File]::WriteAllText(
        $SettingsPath,
        $Settings,
        (New-Object System.Text.UTF8Encoding $false)
    )

    for ($round = 1; $round -le $Rounds; $round++) {
        Invoke-OneRound $true "cold"
        $proc = $script:lastProc
        Start-Sleep -Seconds 8
        if ($proc -and -not $proc.HasExited) {
            $proc.Refresh()
            Add-Sample "system_idle_rss_mb" ($proc.WorkingSet64 / 1MB)
            Add-Sample "system_idle_private_mb" ($proc.PrivateMemorySize64 / 1MB)
        }
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }

    # Warm startup + idle steady state (reuses the index DB from the last round)
    Invoke-OneRound $false "warm"
    $warm = $script:lastProc
    $cpuStart = $warm.TotalProcessorTime.TotalMilliseconds
    Start-Sleep -Seconds $IdleSeconds
    $warm.Refresh()
    $cpuEnd = $warm.TotalProcessorTime.TotalMilliseconds
    $cpuPct = ($cpuEnd - $cpuStart) / ($IdleSeconds * 1000 * [Environment]::ProcessorCount) * 100
    Add-Sample "system_idle_cpu_percent" $cpuPct
    Add-Sample "system_idle_warm_rss_mb" ($warm.WorkingSet64 / 1MB)
    Stop-Process -Id $warm.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

    # One-shot metrics
    $dist = Join-Path $Repo "dist"
    $js = Get-ChildItem $dist -Recurse -Filter "*.js" | Select-Object -First 1
    $css = Get-ChildItem $dist -Recurse -Filter "*.css" | Select-Object -First 1
    if ($js) { Add-Sample "system_bundle_js_gzip_kb" (Get-GzipKb $js.FullName) }
    if ($css) { Add-Sample "system_bundle_css_gzip_kb" (Get-GzipKb $css.FullName) }
    if (Test-Path $DbPath) {
        $dbBytes = (Get-Item $DbPath).Length
        foreach ($suffix in @("-wal", "-shm")) {
            $side = "$DbPath$suffix"
            if (Test-Path $side) { $dbBytes += (Get-Item $side).Length }
        }
        Add-Sample "system_index_db_kb" ($dbBytes / 1KB)
    }

    # Summarize and merge engine results (schema v2)
    $summaryTable = [ordered]@{}
    foreach ($name in ($script:metrics.Keys | Sort-Object)) {
        $unit = switch -Regex ($name) {
            "files_per_sec" { "files/s"; break }
            "rss_mb|private_mb|mem_series" { "MB"; break }
            "per_sec" { "MB/s"; break }
            "kb" { "KB"; break }
            "cpu_percent" { "%"; break }
            default { "ms"; break }
        }
        $summary = Summarize @($script:metrics[$name].ToArray())
        $summaryTable[$name] = [ordered]@{
            unit = $unit
            p50 = $summary.p50
            p90 = $summary.p90
            p99 = $summary.p99
            min = $summary.min
            max = $summary.max
            mean = $summary.mean
            cv = $summary.cv
            samples = $summary.samples
        }
    }
    $engineFile = Join-Path $Repo (Join-Path $ResultsDir "$Version.engine.json")
    if (Test-Path $engineFile) {
        $engine = Get-Content $engineFile -Raw | ConvertFrom-Json
        foreach ($prop in $engine.metrics.PSObject.Properties) {
            $summaryTable[$prop.Name] = $prop.Value
        }
    }

    $rustc = (& rustc --version 2>$null | Select-Object -First 1)
    $node = (& node --version 2>$null | Select-Object -First 1)
    $npmv = (& npm.cmd --version 2>$null | Select-Object -First 1)
    $ramGb = 0
    try { $ramGb = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1) } catch {}
    $ubr = ""
    try {
        $ubrItem = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -Name UBR -ErrorAction Stop
        $ubr = [string]$ubrItem.UBR
    } catch {}
    $result = [ordered]@{
        schema = 2
        version = $Version
        date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        host = @{
            os = [Environment]::OSVersion.VersionString
            ubr = $ubr
            cpu = $env:PROCESSOR_IDENTIFIER
            rustc = $rustc
            node = $node
            npm = $npmv
            ram_gb = $ramGb
            commit = (& git -C $Repo rev-parse --short HEAD 2>$null)
        }
        scenario = @{
            name = "system_v2"
            fixture = @{
                spec = "corpus.json"
                seed = (Get-Corpus).seed
                shape = $Shape
                count = $FileCount
            }
            state = "cold_warm_idle"
            samples = $Rounds
            warmup = 2
        }
        metrics = $summaryTable
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $OutPath) | Out-Null
    [System.IO.File]::WriteAllText(
        $OutPath,
        ($result | ConvertTo-Json -Depth 10),
        (New-Object System.Text.UTF8Encoding $false)
    )

    Write-Host ""
    Write-Host "Benchmark result: $OutPath"
    Write-Host "Rounds: $Rounds | Files: $FileCount | Shape: $Shape | Version: $Version"
    foreach ($name in $summaryTable.Keys) {
        Write-Host ("  {0,-36} p50={1} {2}" -f $name, $summaryTable[$name].p50, $summaryTable[$name].unit)
    }
    if (-not (Test-Path $OutPath)) { throw "Result file was not written" }
    if ($DryRun) {
        $check = Get-Content $OutPath -Raw | ConvertFrom-Json
        $missing = [System.Collections.Generic.List[string]]::new()
        if ($check.schema -ne 2) { $missing.Add("schema=2") }
        if (-not $check.host -or -not $check.host.commit) { $missing.Add("host.commit") }
        if (-not $check.host -or -not $check.host.node) { $missing.Add("host.node") }
        if (-not $check.host -or -not $check.host.npm) { $missing.Add("host.npm") }
        if ($null -eq $check.host -or $null -eq $check.host.ram_gb -or $check.host.ram_gb -le 0) { $missing.Add("host.ram_gb") }
        foreach ($key in @(
            "system_interactive_cold_ms",
            "system_interactive_warm_ms",
            "system_io_cold_read_mb_per_sec",
            "system_io_cold_write_mb_per_sec",
            "system_io_warm_read_mb_per_sec",
            "system_io_warm_write_mb_per_sec"
        )) {
            if ($null -eq $check.metrics.$key) { $missing.Add($key) }
        }
        if ($missing.Count -gt 0) {
            throw "DryRun validation failed: missing $($missing -join ', ')"
        }
        Write-Host "DryRun validation PASS (schema=2, host.commit, interactive+IO keys)"
    }
} finally {
    Restore-UserData
    Remove-Item $FixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$SettingsPath.bench.bak", "$DbPath.bench.bak" -Force -ErrorAction SilentlyContinue
}
