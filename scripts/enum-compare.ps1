param(
    [string]$Root = "",
    [string]$Sizes = "1000,10000,50000",
    [int]$Rounds = 1,
    [string]$OutFile = "benchmarks\enum-compare.md",
    [switch]$Mft,
    [switch]$Edge,
    [string]$MftRead = ""
)

<#
  0.8.6 枚举器全链路一致性对比。
  walkdir 模式：ROOTUP_ENUM=walkdir；原生模式：默认（ROOTUP_ENUM 未设置）；
  -Mft 时增加 MFT 臂（ROOTUP_MFT_SCAN=1，需管理员；未真正启用 MFT 会判 FAIL）。
  -MftRead sequential|parallel|mftfile|nobuffer 选择 MFT 读取变体（实验 A/C/D）。
  -Edge 时使用边界语料（Unicode / 隐藏 / 点文件 / 空目录 / junction / 超长路径 / 深链）。
  每臂各跑一次完整应用扫描并快照 DB，两两用 mft_db_compare.py 比较路径/大小/时间集合。
  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\enum-compare.ps1            # 合成三档
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\enum-compare.ps1 -Edge      # 边界语料
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\enum-compare.ps1 -Mft       # 三臂（管理员）
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

function New-EdgeCorpus([string]$dir) {
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    # Unicode names built from code points (PS 5.1 reads scripts as ANSI, so no literal CJK/emoji).
    $course = (-join [char[]]@(0x8BFE, 0x7A0B, 0x20, 0x4F5C, 0x4E1A, 0xFF08, 0x7B2C, 0x31, 0x7AE0, 0xFF09)) + ".pdf"
    $emoji = "notes" + [char]0xD83D + [char]0xDE00 + ".md"
    [System.IO.File]::WriteAllText((Join-Path $dir $course), "x")
    [System.IO.File]::WriteAllText((Join-Path $dir $emoji), "x")
    [System.IO.File]::WriteAllText((Join-Path $dir ".env"), "x")
    [System.IO.File]::WriteAllText((Join-Path $dir "README"), "x")
    [System.IO.File]::WriteAllText((Join-Path $dir "tmp.crdownload"), "x")
    $hidden = Join-Path $dir "hidden.txt"
    [System.IO.File]::WriteAllText($hidden, "x")
    [System.IO.File]::SetAttributes($hidden, [System.IO.FileAttributes]::Hidden)
    [System.IO.Directory]::CreateDirectory((Join-Path $dir "empty")) | Out-Null
    $deep = Join-Path $dir "deep"
    for ($d = 0; $d -lt 20; $d++) {
        $deep = Join-Path $deep ("d" + $d.ToString("00"))
        [System.IO.Directory]::CreateDirectory($deep) | Out-Null
    }
    [System.IO.File]::WriteAllText((Join-Path $deep "leaf.txt"), "x")
    # Long path (>260): create via verbatim, enumerate via normal path.
    $longDir = Join-Path $dir (("L" * 70) + "\" + ("M" * 70) + "\" + ("N" * 70) + "\" + ("O" * 70))
    $verbatim = "\\?\" + $longDir
    [System.IO.Directory]::CreateDirectory($verbatim) | Out-Null
    [System.IO.File]::WriteAllText(($verbatim + "\long.txt"), "x")
    # Junction (best effort; failure does not affect other assertions).
    $target = Join-Path $env:TEMP ("rootup_enum_edge_target_" + [guid]::NewGuid().ToString("N"))
    [System.IO.Directory]::CreateDirectory((Join-Path $target "sub")) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $target "sub\inner.txt"), "x")
    $link = Join-Path $dir "junction"
    & cmd /C mklink /J $link $target 2>$null | Out-Null
    Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-OneScan([string]$dir, [string]$mode) {
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
    Remove-Item Env:ROOTUP_ENUM -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_MFT_SCAN -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_MFT_READ -ErrorAction SilentlyContinue
    if ($mode -eq "walkdir") { $env:ROOTUP_ENUM = "walkdir" }
    elseif ($mode -eq "mft") {
        $env:ROOTUP_MFT_SCAN = "1"
        if ($MftRead -ne "") { $env:ROOTUP_MFT_READ = $MftRead }
    }
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
    $mftUsed = $false
    if ($mode -eq "mft" -and (Test-Path $LogFile)) {
        $mftUsed = (Get-Content $LogFile -Raw -ErrorAction SilentlyContinue) -match "MFT enumerator used"
    } elseif ($mode -ne "mft") {
        $mftUsed = $true
    }
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $line) { return $null }
    $readMs = $null
    if ($mode -eq "mft" -and (Test-Path $LogFile)) {
        $rm = Select-String -Path $LogFile -Pattern 'read_ms=(\d+)' | Select-Object -Last 1
        if ($rm -and $rm.Matches.Count -gt 0) { $readMs = [double]$rm.Matches[0].Groups[1].Value }
    }
    return [pscustomobject]@{
        discovered = [int]($line -replace '.*discovered=(\d+).*', '$1')
        errors = [int]($line -replace '.*errors=(\d+).*', '$1')
        elapsed = [double]($line -replace '.*elapsed_ms=(\d+).*', '$1')
        dbMs = [double]($line -replace '.*db_ms=(\d+).*', '$1')
        mftUsed = $mftUsed
        readMs = $readMs
    }
}

function Copy-DbSnapshot([string]$destDir) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    foreach ($suffix in @("", "-wal", "-shm")) {
        $src = Join-Path $AppData ("rootup.db" + $suffix)
        if (Test-Path $src) { Copy-Item $src (Join-Path $destDir ("rootup.db" + $suffix)) -Force }
    }
}

$modeList = @("walkdir", "native")
if ($Mft) { $modeList += "mft" }
if ($MftRead -ne "" -and $MftRead -notin @("sequential", "parallel")) {
    Write-Error "MftRead 仅支持 sequential|parallel（mftfile/nobuffer 已按实验结论移除）"
}
$sizeList = if ($Root) { @(-1) } elseif ($Edge) { @(-2) } else { @($Sizes -split '[, ]+' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ }) }
Write-Host "[enum-compare] modes=$($modeList -join ',') sizes=<$($sizeList -join ',')> rounds=$Rounds root=<$Root> edge=$Edge"

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
    $reportLines.Add("# Enumerator full-pipeline consistency")
    $reportLines.Add("")
    $reportLines.Add("- Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $reportLines.Add("- Host: $([Environment]::OSVersion.VersionString)")
    $reportLines.Add("- Modes: $($modeList -join ' + ')")
    $reportLines.Add("- MftRead: <$MftRead>")
    $reportLines.Add("- Rounds: $Rounds")
    $reportLines.Add("")
    $reportLines.Add("| label | A files | B files | A-only | B-only | size diff | time diff | ratio | verdict |")
    $reportLines.Add("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    [System.IO.File]::WriteAllLines($Report, $reportLines, (New-Object System.Text.UTF8Encoding($false)))

    $allOk = $true
    foreach ($size in $sizeList) {
        $rawDir = if ($Root) { $Root } elseif ($Edge) { Join-Path $env:TEMP "rootup_enum_corpus_edge" } else { Join-Path $env:TEMP ("rootup_enum_corpus_" + $size) }
        if (-not $Root) {
            Remove-Item $rawDir -Recurse -Force -ErrorAction SilentlyContinue
            if ($Edge) {
                Write-Host "[enum-compare] creating edge corpus..."
                New-EdgeCorpus $rawDir
            } else {
                Write-Host ("[enum-compare] creating corpus {0}..." -f $size)
                New-Corpus $rawDir $size
            }
        }
        $dir = $rawDir.Replace("\", "/")
        $label = if ($Root) { "real" } elseif ($Edge) { "edge" } else { $size }
        for ($r = 1; $r -le $Rounds; $r++) {
            $results = @{}
            foreach ($mode in $modeList) {
                foreach ($suffix in @("", "-wal", "-shm")) {
                    Remove-Item (Join-Path $AppData ("rootup.db" + $suffix)) -Force -ErrorAction SilentlyContinue
                }
                Write-Host "[enum-compare] $label round $r $mode..."
                $res = Invoke-OneScan $dir $mode
                if (-not $res) {
                    Write-Host "[enum-compare] $label round $r $mode failed or timed out"
                    $allOk = $false
                    continue
                }
                if ($mode -eq "mft" -and -not $res.mftUsed) {
                    Write-Host "[enum-compare] $label round $r mft NOT used (fallback) -> FAIL"
                    $allOk = $false
                }
                Copy-DbSnapshot (Join-Path $SnapDir ("$mode" + "_" + $label + "_" + $r))
                $results[$mode] = $res
                Add-Content $Report ("- elapsed_ms: $label $mode = " + $res.elapsed)
                if ($mode -eq "mft") {
                    Add-Content $Report ("- mft_used: $label = " + $res.mftUsed)
                }
                if ($mode -eq "mft" -and $null -ne $res.readMs) {
                    Add-Content $Report ("- read_ms: $label $mode = " + $res.readMs)
                }
            }
            $pairs = @(, @("walkdir", "native"))
            if ($Mft) {
                $pairs += , @("walkdir", "mft")
                $pairs += , @("native", "mft")
            }
            foreach ($pair in $pairs) {
                $a = $pair[0]; $b = $pair[1]
                if (-not $results.ContainsKey($a) -or -not $results.ContainsKey($b)) { continue }
                $pairLabel = "$label-$a-vs-$b"
                & python $Compare (Join-Path $SnapDir ("$a" + "_" + $label + "_" + $r + "\rootup.db")) (Join-Path $SnapDir ("$b" + "_" + $label + "_" + $r + "\rootup.db")) $dir $Report $pairLabel "strict"
                if ($LASTEXITCODE -ne 0) { $allOk = $false }
                $readPart = ""
                if ($a -eq "mft" -and $null -ne $results[$a].readMs) { $readPart += " readA_ms=" + $results[$a].readMs }
                if ($b -eq "mft" -and $null -ne $results[$b].readMs) { $readPart += " readB_ms=" + $results[$b].readMs }
                Write-Host ("[enum-compare] {0} {1}={2}ms db={3}ms {4}={5}ms db={6}ms discovered {7}/{8} errors {9}/{10}{11}" -f `
                    $pairLabel, $a, $results[$a].elapsed, $results[$a].dbMs, $b, $results[$b].elapsed, $results[$b].dbMs, $results[$a].discovered, $results[$b].discovered, $results[$a].errors, $results[$b].errors, $readPart)
            }
        }
        if (-not $Root) { Remove-Item $rawDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Write-Host "Report: $Report"
    if ($allOk) { Write-Host "RESULT: PASS"; exit 0 } else { Write-Host "RESULT: FAIL"; exit 1 }
} finally {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_ENUM -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_MFT_SCAN -ErrorAction SilentlyContinue
    Remove-Item Env:ROOTUP_MFT_READ -ErrorAction SilentlyContinue
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
