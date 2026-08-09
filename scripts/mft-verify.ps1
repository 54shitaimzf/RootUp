param(
    [string]$Root = "",
    [switch]$Huge,
    [int]$Rounds = 3,
    [string]$Sizes = "",
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
$DbPath = Join-Path $AppData "rootup.db"
$LogDir = Join-Path $env:TEMP "rootup_mft_logs"

$sizeList = @(1000, 10000, 50000)
if ($Sizes -ne "") {
    # PS 5.1 + LF: keep comments ASCII so they never swallow the next line.
    # Accept comma/space separated values (unquoted -Sizes 20000,30000 arrives as "20000 30000").
    $sizeList = @($Sizes -split '[, ]+' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })
} elseif ($Huge) {
    $sizeList += @(100000, 300000)
}
if ($Sizes -ne "" -and $sizeList.Count -eq 0) {
    Write-Error "Sizes 参数无法解析: [$Sizes]"
}
Write-Host "[mft-verify] SizesParam=<$Sizes> sizes=$($sizeList -join ',')"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges are required (MFT raw read needs SeBackupPrivilege)."
}
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
public static class RootUpCorpusGen {
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
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    [RootUpCorpusGen]::Create($dir, $count, [Math]::Min(8, [Environment]::ProcessorCount))
    Write-Host ("[mft-verify] corpus {0} files ready in {1:N1}s" -f $count, $sw.Elapsed.TotalSeconds)
}

function Get-LongPath([string]$path) {
    $memberDef = '[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile); [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint GetFinalPathNameByHandle(IntPtr hFile, System.Text.StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr hObject);'
    try {
        Add-Type -Namespace RootUp.Tools -Name LongPath -MemberDefinition $memberDef -ErrorAction Stop
    } catch {
        # Type already loaded or compile failed: fall back to the raw path (8.3 may mismatch MFT prefix).
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
    $timeoutSec = if ($mft -and $dir -match "300000") { 480 } else { 240 }
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    $line = ""
    $mftUsed = $false
    $leaf = Split-Path -Leaf $dir
    $pattern = "scan: .*" + [regex]::Escape($leaf) + ".*discovered="
    while ((Get-Date) -lt $deadline -and -not $line) {
        Start-Sleep -Milliseconds 200
        if (Test-Path $LogFile) {
            $m = Get-Content $LogFile -Tail 200 -ErrorAction SilentlyContinue | Select-String -Pattern $pattern | Select-Object -Last 1
            if ($m) { $line = $m.Line }
        }
    }
    if ($mft -and (Test-Path $LogFile)) {
        $raw = Get-Content $LogFile -Raw
        $mftUsed = $raw -match "MFT enumerator used"
    } elseif (-not $mft) {
        $mftUsed = $true
    }
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $line) { return $null }
    return [pscustomobject]@{
        discovered = [int]($line -replace '.*discovered=(\d+).*', '$1')
        errors = [int]($line -replace '.*errors=(\d+).*', '$1')
        elapsed = [double]($line -replace '.*elapsed_ms=(\d+).*', '$1')
        mftUsed = $mftUsed
    }
}

function P50($values) {
    $sorted = @($values | Sort-Object)
    $sorted[[int]($sorted.Count / 2)]
}

    if (Test-Path $SettingsPath) { Copy-Item $SettingsPath $Backup -Force }
    $DbBackup = Join-Path $env:TEMP "rootup_mftverify_db_backup"
    Remove-Item $DbBackup -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $DbPath) {
        New-Item -ItemType Directory -Path $DbBackup | Out-Null
        foreach ($suffix in @("", "-wal", "-shm")) {
            $src = Join-Path $AppData ("rootup.db" + $suffix)
            if (Test-Path $src) { Copy-Item $src (Join-Path $DbBackup ("rootup.db" + $suffix)) -Force }
        }
    }
    Remove-Item $LogDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $LogDir | Out-Null
try {
    $report = [System.Collections.Generic.List[string]]::new()
    $report.Add("# MFT/walkdir crossover experiment")
    $report.Add("")
    $report.Add("- Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $report.Add("- Host: $([Environment]::OSVersion.VersionString) (UBR $(try { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name UBR).UBR } catch { '?' }))")
    $report.Add("- Admin: $isAdmin")
    if ($Root -ne "") { $corpusDesc = "real dir $Root" } else { $corpusDesc = "generated" }
    $report.Add("- Corpus: $corpusDesc")
    $report.Add("- Sizes param: <$Sizes>")
    $report.Add("- Sizes used: $($sizeList -join ',')")
    $report.Add("")
    $report.Add("| size | walkdir p50 (ms) | MFT p50 (ms) | count match | errors | winner |")
    $report.Add("| --- | --- | --- | --- | --- | --- |")

    if ($Root) { $sizeList = @(-1) }
    foreach ($size in $sizeList) {
        $rawDir = if ($Root) { $Root } else { Join-Path $env:TEMP ("rootup_mft_corpus_" + $size) }
        # 每档使用干净数据库，避免上一档语料拖慢启动与扫描
        Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
        foreach ($suffix in @("", "-wal", "-shm")) {
            Remove-Item (Join-Path $AppData ("rootup.db" + $suffix)) -Force -ErrorAction SilentlyContinue
        }
        if (-not $Root) {
            Remove-Item $rawDir -Recurse -Force -ErrorAction SilentlyContinue
            New-Corpus $rawDir $size
        }
        # Use long paths so walkdir and MFT share the same prefix (%TEMP% may be an 8.3 short path).
        $dir = Get-LongPath $rawDir
        $label = if ($Root) { "real" } else { $size }
        $walk = @(); $mft = @(); $countOk = $true
        for ($r = 0; $r -lt $Rounds; $r++) {
            Write-Host ("[mft-verify] {0} walkdir round {1}/{2}..." -f $label, ($r + 1), $Rounds)
            $w = Invoke-OneScan $dir $false
            Copy-Item $LogFile (Join-Path $LogDir ("{0}_walk_{1}.log" -f $label, $r)) -Force -ErrorAction SilentlyContinue
            Write-Host ("[mft-verify] {0} MFT round {1}/{2}..." -f $label, ($r + 1), $Rounds)
            $m = Invoke-OneScan $dir $true
            Copy-Item $LogFile (Join-Path $LogDir ("{0}_mft_{1}.log" -f $label, $r)) -Force -ErrorAction SilentlyContinue
            if ($m) { Write-Host ("[mft-verify] {0} MFT round {1}/{2} mftUsed={3} discovered={4}" -f $label, ($r + 1), $Rounds, $m.mftUsed, $m.discovered) }
            if (-not $w -or -not $m) { $countOk = $false; break }
            if ($w.discovered -ne $m.discovered -or $w.errors -ne 0 -or $m.errors -ne 0 -or -not $m.mftUsed) { $countOk = $false }
            $walk += $w.elapsed; $mft += $m.elapsed
        }
        $wp = P50 $walk; $mp = P50 $mft
        $better = if ($countOk) { if ($mp -lt $wp) { "MFT" } elseif ($mp -gt $wp) { "walkdir" } else { "tie" } } else { "consistency failed" }
        $report.Add("| $label | $wp | $mp | $countOk | 0/0 | $better |")
        Write-Host ("[mft-verify] {0} done: walk={1}ms mft={2}ms ok={3} winner={4}" -f $label, $wp, $mp, $countOk, $better)
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
    if (Test-Path $DbBackup) {
        foreach ($suffix in @("", "-wal", "-shm")) {
            $src = Join-Path $DbBackup ("rootup.db" + $suffix)
            if (Test-Path $src) { Copy-Item $src (Join-Path $AppData ("rootup.db" + $suffix)) -Force }
        }
        Remove-Item $DbBackup -Recurse -Force -ErrorAction SilentlyContinue
    }
}
