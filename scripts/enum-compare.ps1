param(
    [string]$Root = "",
    [string]$Sizes = "1000,10000,50000",
    [int]$Rounds = 1,
    [string]$OutFile = "benchmarks\enum-compare.md"
)

<#
  0.8.6 原生枚举器 vs walkdir 全链路对比（无需管理员）。
  walkdir 模式：ROOTUP_ENUM=walkdir；原生模式：默认（ROOTUP_ENUM 未设置）。
  每个模式各跑一次完整应用扫描并快照 DB，用 mft_db_compare.py 比较路径/大小/时间集合。
  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\enum-compare.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\enum-compare.ps1 -Root "C:\Users\Administrator\Desktop"
#>

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Repo "src-tauri\target\release\rootup.exe"
$AppData = Join-Path $env:APPDATA "com.rootup.desktop"
$SettingsPath = Join-Path $AppData "settings.json"
$Backup = "$SettingsPath.enumcompare.bak"
$LogFile = Join-Path $env:LOCALAPPDATA "com.rootup.desktop\logs\rootup.log"
$DbPath = Join-Path $AppData "rootup.db"
$SnapDir = Join-Path $env:TEMP "rootup_enum_compare_snapshots"
$DbBackup = Join-Path $env:TEMP "rootup_enumcompare_db_backup"
$Compare = Join-Path $PSScriptRoot "mft_db_compare.py"
$Report = Join-Path $Repo $OutFile

if (-not (Test-Path $Exe)) {
    Write-Error "Build release first: npm run tauri build -- --no-bundle"
}

$script:CorpusGenLoaded = $false
function New-Corpus([string]$dir, [int]$count) {
    if (-not $script:CorpusGenLoaded) {
        Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Threading.Tasks;
public static class RootUpCorpusGenEnum {
    public static void Create(string dir, int count, int parallelism) {
        for (int d = 0; d < 100; d++) Directory.CreateDirectory(Path.Combine(dir, "d" + d.ToString("000")));
        var opts = new ParallelOptions { MaxDegreeOfParallelism = parallelism };
        Parallel.For(0, count, opts, i => {
            string sub = Path.Combine(dir, "d" + (i % 100).ToString("000"));
            File.WriteAllText(Path.Combine(sub, "f" + i.ToString("000000") + ".txt"), "x");
        });
    }
}
"@ -ErrorAction Stop
        $script:CorpusGenLoaded = $true
    }
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    [RootUpCorpusGenEnum]::Create($dir, $count, [Math]::Min(8, [Environment]::ProcessorCount))
}

function Invoke-OneScan([string]$dir, [bool]$win32) {
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
    if ($win32) { Remove-Item Env:ROOTUP_ENUM -ErrorAction SilentlyContinue } else { $env:ROOTUP_ENUM = "walkdir" }
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

$sizeList = @($Sizes -split '[, ]+' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })
if ($Root -ne "") { $sizeList = @(-1) }
Write-Host "[enum-compare] sizes=<$($sizeList -join ',')> rounds=$Rounds root=<$Root>"

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
    $reportLines = [System.Collections.Generic.List[string]]::new()
    $reportLines.Add("# Native vs walkdir full-pipeline comparison")
    $reportLines.Add("")
    $reportLines.Add("- Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $reportLines.Add("- Host: $([Environment]::OSVersion.VersionString)")
    $reportLines.Add("- Root: $(if ($Root) { $Root } else { 'generated' })")
    $reportLines.Add("- Rounds: $Rounds")
    $reportLines.Add("")
    $reportLines.Add("| label | walk files | native files | walk-only | native-only | size diff | time diff | ratio | verdict |")
    $reportLines.Add("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    [System.IO.File]::WriteAllLines($Report, $reportLines, (New-Object System.Text.UTF8Encoding($false)))

    $allOk = $true
    foreach ($size in $sizeList) {
        $rawDir = if ($Root) { $Root } else { Join-Path $env:TEMP ("rootup_enum_corpus_" + $size) }
        if (-not $Root) {
            Remove-Item $rawDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host ("[enum-compare] creating corpus {0}..." -f $size)
            New-Corpus $rawDir $size
        }
        $dir = $rawDir.Replace("\", "/")
        $label = if ($Root) { "real" } else { $size }
        for ($r = 1; $r -le $Rounds; $r++) {
            foreach ($suffix in @("", "-wal", "-shm")) {
                Remove-Item (Join-Path $AppData ("rootup.db" + $suffix)) -Force -ErrorAction SilentlyContinue
            }
            Write-Host "[enum-compare] $label round $r walkdir..."
            $w = Invoke-OneScan $dir $false
            Copy-DbSnapshot (Join-Path $SnapDir ("walk_" + $label + "_" + $r))
            foreach ($suffix in @("", "-wal", "-shm")) {
                Remove-Item (Join-Path $AppData ("rootup.db" + $suffix)) -Force -ErrorAction SilentlyContinue
            }
            Write-Host "[enum-compare] $label round $r native..."
            $n = Invoke-OneScan $dir $true
            Copy-DbSnapshot (Join-Path $SnapDir ("native_" + $label + "_" + $r))
            if (-not $w -or -not $n) {
                Write-Host "[enum-compare] $label round $r scan failed or timed out"
                $allOk = $false
                continue
            }
            & python $Compare (Join-Path $SnapDir ("walk_" + $label + "_" + $r + "\rootup.db")) (Join-Path $SnapDir ("native_" + $label + "_" + $r + "\rootup.db")) $dir $Report $label
            if ($LASTEXITCODE -ne 0) { $allOk = $false }
            Write-Host ("[enum-compare] {0} round {1} walk={2}ms db={3}ms native={4}ms db={5}ms discovered {6}/{7} errors {8}/{9}" -f `
                $label, $r, $w.elapsed, $w.dbMs, $n.elapsed, $n.dbMs, $w.discovered, $n.discovered, $w.errors, $n.errors)
        }
        if (-not $Root) { Remove-Item $rawDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Write-Host "Report: $Report"
    if ($allOk) { Write-Host "RESULT: PASS" } else { Write-Host "RESULT: FAIL" }
} finally {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_ENUM -ErrorAction SilentlyContinue
    if (Test-Path $Backup) { Move-Item $Backup $SettingsPath -Force } else { Remove-Item $SettingsPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $DbBackup) {
        foreach ($suffix in @("", "-wal", "-shm")) {
            $src = Join-Path $DbBackup ("rootup.db" + $suffix)
            if (Test-Path $src) { Copy-Item $src (Join-Path $AppData ("rootup.db" + $suffix)) -Force }
        }
        Remove-Item $DbBackup -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $SnapDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "cleanup done"
}
