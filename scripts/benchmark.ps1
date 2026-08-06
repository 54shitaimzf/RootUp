param(
    [string]$ExePath = "src-tauri\target\release\rootup.exe",
    [int]$Rounds = 5,
    [string]$Version = "",
    [switch]$Full,
    [switch]$DryRun,
    [string]$ResultsDir = "benchmarks\results"
)

# System-level benchmark (custom harness): cold start, scan, memory and bundle
# size. Backs up and restores the real settings + index DB so user data is
# untouched. Run after `npm run tauri build -- --no-bundle`.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression

if (-not $Version) {
    $pkg = Get-Content (Join-Path $Repo "package.json") -Raw | ConvertFrom-Json
    $Version = $pkg.version
}
if ($DryRun) { $Rounds = 1 }

$Exe = Join-Path $Repo $ExePath
if (-not (Test-Path $Exe)) { throw "Release exe not found: $Exe" }

$FileCount = if ($DryRun) { 100 } elseif ($Full) { 100000 } else { 10000 }
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

function New-Fixture([string]$Root, [int]$Count) {
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    $dirs = 100
    $per = [Math]::Max(1, [Math]::Ceiling($Count / $dirs))
    for ($d = 0; $d -lt $dirs; $d++) {
        $dir = Join-Path $Root ("d" + $d.ToString("D3"))
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        for ($i = 0; $i -lt $per; $i++) {
            $path = Join-Path $dir ("f" + $i.ToString("D5") + ".txt")
            [System.IO.File]::Open($path, [System.IO.FileMode]::Create).Close()
        }
    }
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

function Summarize([double[]]$Values) {
    if ($Values.Count -eq 0) { return $null }
    $sorted = @($Values | Sort-Object)
    $n = $sorted.Count
    $median = $sorted[[Math]::Floor($n / 2)]
    $p90idx = [Math]::Min($n - 1, [Math]::Max(0, [Math]::Ceiling($n * 0.9) - 1))
    return @{
        median = [Math]::Round($median, 3)
        p90 = [Math]::Round($sorted[$p90idx], 3)
        min = [Math]::Round($sorted[0], 3)
        max = [Math]::Round($sorted[$n - 1], 3)
        samples = $n
    }
}

try {
    Stop-RootUp
    # 防御：上次异常残留的备份先恢复
    if (Test-Path $SettingsBackup) { Restore-UserData }

    if (Test-Path $SettingsPath) { Copy-Item $SettingsPath $SettingsBackup -Force }
    if (Test-Path $DbPath) { Copy-Item $DbPath $DbBackup -Force }

    New-Fixture $FixtureRoot $FileCount
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
        Remove-Item $LogFile, $DbPath, "$DbPath-wal", "$DbPath-shm" -Force -ErrorAction SilentlyContinue
        $Proc = Start-Process -FilePath $Exe -PassThru

        $startupMs = Wait-LogLine "rootup_lib::app RootUp" 60
        Add-Sample "system_startup_log_ms" $startupMs

        $interactiveMs = Wait-LogLine "settings: " $(if ($DryRun) { 15 } else { 30 })
        Add-Sample "system_interactive_ms" $interactiveMs

        $peak = 0
        $scanLine = $null
        $deadline = (Get-Date).AddSeconds(600)
        while ((Get-Date) -lt $deadline) {
            if ($Proc -and -not $Proc.HasExited) {
                $rss = $Proc.WorkingSet64
                if ($rss -gt $peak) { $peak = $rss }
            }
            if (Test-Path $LogFile) {
                $m = Select-String -Path $LogFile -Pattern "elapsed_ms=" -SimpleMatch |
                    Select-Object -Last 1
                if ($m) { $scanLine = $m.Line; break }
            }
            Start-Sleep -Milliseconds 200
        }
        if (-not $scanLine) { throw "Scan did not finish in round $round" }
        Add-Sample "system_scan_peak_rss_mb" ($peak / 1MB)
        if ($scanLine -match "elapsed_ms=(\d+)") {
            Add-Sample "system_scan_ms" ([double]$Matches[1])
        }
        if ($scanLine -match "files_per_sec=([\d.]+)") {
            Add-Sample "system_scan_files_per_sec" ([double]$Matches[1])
        }

        Start-Sleep -Seconds 8
        if ($Proc -and -not $Proc.HasExited) {
            $Proc.Refresh()
            Add-Sample "system_idle_rss_mb" ($Proc.WorkingSet64 / 1MB)
            Add-Sample "system_idle_private_mb" ($Proc.PrivateMemorySize64 / 1MB)
        }
        Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }

    # 一次性指标
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

    # 汇总并合并引擎结果
    $summaries = [ordered]@{}
    foreach ($name in ($script:metrics.Keys | Sort-Object)) {
        $unit = switch -Regex ($name) {
            "rss_mb|private_mb" { "MB" }
            "kb" { "KB" }
            "files_per_sec" { "files/s" }
            default { "ms" }
        }
        $summary = Summarize @($script:metrics[$name].ToArray())
        $summaries[$name] = [ordered]@{
            unit = $unit
            median = $summary.median
            p90 = $summary.p90
            min = $summary.min
            max = $summary.max
            samples = $summary.samples
        }
    }
    $engineFile = Join-Path $Repo (Join-Path $ResultsDir "$Version.engine.json")
    if (Test-Path $engineFile) {
        $engine = Get-Content $engineFile -Raw | ConvertFrom-Json
        foreach ($prop in $engine.PSObject.Properties) {
            $summaries[$prop.Name] = $prop.Value
        }
    }

    $result = [ordered]@{
        version = $Version
        date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        host = @{
            os = [Environment]::OSVersion.VersionString
            cpu = $env:PROCESSOR_IDENTIFIER
        }
        rounds = $Rounds
        metrics = $summaries
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $OutPath) | Out-Null
    [System.IO.File]::WriteAllText(
        $OutPath,
        ($result | ConvertTo-Json -Depth 8),
        (New-Object System.Text.UTF8Encoding $false)
    )

    Write-Host ""
    Write-Host "Benchmark result: $OutPath"
    Write-Host "Rounds: $Rounds | Files: $FileCount | Version: $Version"
    foreach ($name in $summaries.Keys) {
        Write-Host ("  {0,-32} median={1} {2}" -f $name, $summaries[$name].median, $summaries[$name].unit)
    }
    if (-not (Test-Path $OutPath)) { throw "Result file was not written" }
} finally {
    Restore-UserData
    Remove-Item $FixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$SettingsPath.bench.bak", "$DbPath.bench.bak" -Force -ErrorAction SilentlyContinue
}
