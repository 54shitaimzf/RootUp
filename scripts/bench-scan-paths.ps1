param(
    [string]$Root = "",
    [string]$Sizes = "1000,10000,20000,30000,50000",
    [int]$Rounds = 3,
    [switch]$SkipDbCompare,
    [string]$OutFile = "benchmarks\scan-paths-0.8.6.md",
    [string]$JsonOut = "benchmarks\results\0.8.6.scan.json",
    [string]$CorpusDir = "",
    [switch]$KeepCorpus,
    [switch]$PrepareCorpusOnly
)

<#
  0.8.6 scan-path comparison (run as Administrator).
  States (each a full app scan on a clean index):
    walkdir   -> ROOTUP_ENUM=walkdir, MFT disabled
    native    -> default Win32 enumerator, MFT disabled
    mft       -> ROOTUP_MFT_SCAN=1 + ROOTUP_MFT_FORCE=1 (diagnostic force)
    optimizer -> ROOTUP_MFT_SCAN=1, force off (model + hysteresis decides)
  Consistency: discovered/errors must match across states; the MFT state must
  report mftUsed=true; DB path/size/time sets must match pairwise (strict).
  Output: JSON (0.8.6.scan.json) + Markdown report.
#>

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Repo "src-tauri\target\release\rootup.exe"
$AppData = Join-Path $env:APPDATA "com.rootup.desktop"
$SettingsPath = Join-Path $AppData "settings.json"
$Backup = "$SettingsPath.scanpaths.bak"
$DbPath = Join-Path $AppData "rootup.db"
$LogFile = Join-Path $env:LOCALAPPDATA "com.rootup.desktop\logs\rootup.log"
$LogDir = Join-Path $env:TEMP "rootup_scan_paths_logs"
$SnapDir = Join-Path $env:TEMP "rootup_scan_paths_snapshots"
$Compare = Join-Path $PSScriptRoot "mft_db_compare.py"

if (-not $PrepareCorpusOnly) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Error "Administrator privileges are required (MFT raw read needs SeBackupPrivilege)."
    }
    if (-not (Test-Path $Exe)) {
        Write-Error "Build release first: npm run tauri build -- --no-bundle"
    }
}

$sizeList = @($Sizes -split '[, ]+' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })
if ($sizeList.Count -eq 0) { Write-Error "Sizes could not be parsed: [$Sizes]" }
$states = @("walkdir", "native", "mft", "optimizer")

$script:CorpusGenLoaded = $false
function New-Corpus([string]$dir, [int]$count) {
    if (-not $script:CorpusGenLoaded) {
        Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Threading.Tasks;
public static class RootUpScanPathsCorpus {
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
    [RootUpScanPathsCorpus]::Create($dir, $count, [Math]::Min(8, [Environment]::ProcessorCount))
    Write-Host ("[scan-paths] corpus {0} files ready in {1:N1}s" -f $count, $sw.Elapsed.TotalSeconds)
}

if ($PrepareCorpusOnly) {
    $base = if ($CorpusDir) { $CorpusDir } else { Join-Path $env:TEMP "rootup_scan_paths_corpus" }
    New-Item -ItemType Directory -Force -Path $base | Out-Null
    foreach ($size in $sizeList) {
        $raw = Join-Path $base ("corpus_" + $size)
        $marker = $raw + ".prepared"
        if (Test-Path $marker) {
            Write-Host "Scan corpus already prepared: $raw"
            continue
        }
        Remove-Item $raw -Recurse -Force -ErrorAction SilentlyContinue
        New-Corpus $raw $size
        Set-Content -Path $marker -Value "1" -Encoding ASCII
    }
    Write-Host "Scan corpora prepared under $base"
    exit 0
}

function Get-LongPath([string]$path) {
    $memberDef = '[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile); [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint GetFinalPathNameByHandle(IntPtr hFile, System.Text.StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr hObject);'
    try {
        Add-Type -Namespace RootUp.Tools.ScanPaths -Name LongPath -MemberDefinition $memberDef -ErrorAction Stop
    } catch {
        # Type already loaded or compile failed: fall back to raw path.
    }
    $h = [RootUp.Tools.ScanPaths.LongPath]::CreateFileW($path, 0x80, 0x1 -bor 0x2, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
    if ($h -eq [IntPtr]::Zero -or $h -eq [IntPtr](-1)) { return $path }
    try {
        $sb = New-Object System.Text.StringBuilder 32768
        $len = [RootUp.Tools.ScanPaths.LongPath]::GetFinalPathNameByHandle($h, $sb, $sb.Capacity, 0)
        if ($len -eq 0 -or $len -gt $sb.Capacity) { return $path }
        $final = $sb.ToString(0, [int]$len)
        if ($final.StartsWith('\\?\')) { $final = $final.Substring(4) }
        return $final
    } finally {
        [RootUp.Tools.ScanPaths.LongPath]::CloseHandle($h) | Out-Null
    }
}

function Stop-RootUp {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

function Clear-IndexDb {
    foreach ($suffix in @("", "-wal", "-shm")) {
        Remove-Item (Join-Path $AppData ("rootup.db" + $suffix)) -Force -ErrorAction SilentlyContinue
    }
}

function Set-StateEnv([string]$state) {
    Remove-Item Env:ROOTUP_MFT_SCAN, Env:ROOTUP_MFT_FORCE, Env:ROOTUP_ENUM -ErrorAction SilentlyContinue
    if ($state -eq "walkdir") { $env:ROOTUP_ENUM = "walkdir" }
    elseif ($state -eq "mft") { $env:ROOTUP_MFT_SCAN = "1"; $env:ROOTUP_MFT_FORCE = "1" }
    elseif ($state -eq "optimizer") { $env:ROOTUP_MFT_SCAN = "1" }
}

function Invoke-OneScan([string]$dir, [string]$state) {
    Stop-RootUp
    Clear-IndexDb
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
    Set-StateEnv $state
    Start-Process -FilePath $Exe | Out-Null

    $deadline = (Get-Date).AddSeconds(300)
    $leaf = Split-Path -Leaf $dir
    $done = $null
    while ((Get-Date) -lt $deadline -and -not $done) {
        Start-Sleep -Milliseconds 200
        if (Test-Path $LogFile) {
            $line = Get-Content $LogFile -Tail 300 -ErrorAction SilentlyContinue |
                Select-String -Pattern ("scan: 完成 .*" + [regex]::Escape($leaf) + ".*discovered=") |
                Select-Object -Last 1
            if ($line) { $done = $line.Line }
        }
    }
    Stop-RootUp
    if (-not $done) { return $null }

    $raw = ""
    if (Test-Path $LogFile) { $raw = Get-Content $LogFile -Raw }
    $discovered = [int]($done -replace '.*discovered=(\d+).*', '$1')
    $errors = [int]($done -replace '.*errors=(\d+).*', '$1')
    $elapsed = [double]($done -replace '.*elapsed_ms=(\d+).*', '$1')
    $readMs = $null
    $stage = [regex]::Match($raw, 'scan: MFT 阶段 read_ms=(\d+) parse_ms=(\d+) resolve_ms=(\d+)')
    if ($stage.Success) { $readMs = [double]$stage.Groups[1].Value }
    $decision = $null
    $decisionLine = [regex]::Match($raw, 'scan: 快速扫描决策 .*?root_count=(\d+) crossover=([^\s]+) use_mft=(true|false) force_mft=(true|false)')
    if ($decisionLine.Success) {
        $decision = [ordered]@{
            root_count = [long]$decisionLine.Groups[1].Value
            crossover = $decisionLine.Groups[2].Value
            use_mft = $decisionLine.Groups[3].Value -eq "true"
            force_mft = $decisionLine.Groups[4].Value -eq "true"
        }
    }
    $mftUsed = $raw -match "MFT enumerator used"
    return [pscustomobject]@{
        discovered = $discovered
        errors = $errors
        elapsed = $elapsed
        read_ms = $readMs
        mftUsed = $mftUsed
        decision = $decision
        state = $state
    }
}

function Invoke-Checkpoint([string]$db) {
    if (-not (Test-Path $db)) { return }
    $code = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()"
    & python -c $code $db 2>$null | Out-Null
}

function Save-Snapshot([string]$label) {
    Invoke-Checkpoint $DbPath
    $target = Join-Path $SnapDir ("{0}.db" -f $label)
    Copy-Item $DbPath $target -Force
}

function P50($values) {
    if ($values.Count -eq 0) { return $null }
    $sorted = @($values | Sort-Object)
    $sorted[[Math]::Floor(($sorted.Count - 1) / 2)]
}

function New-Stats($values) {
    if ($values.Count -eq 0) { return $null }
    $sorted = @($values | Sort-Object)
    $n = $sorted.Count
    $pct = {
        param($p)
        $idx = [Math]::Min([int][Math]::Ceiling($n * $p) - 1, $n - 1)
        $sorted[[Math]::Max($idx, 0)]
    }
    $mean = ($sorted | Measure-Object -Average).Average
    $variance = ($sorted | ForEach-Object { ($_ - $mean) * ($_ - $mean) } | Measure-Object -Average).Average
    $cv = if ($mean -ne 0) { [Math]::Sqrt($variance) / $mean } else { 0.0 }
    return [ordered]@{
        unit = "ms"
        p50 = (& $pct 0.5)
        p90 = (& $pct 0.9)
        p99 = (& $pct 0.99)
        min = $sorted[0]
        max = $sorted[$n - 1]
        mean = $mean
        cv = $cv
        samples = $n
    }
}

function Get-HostFingerprint {
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
    $commit = (& git -C $Repo rev-parse --short HEAD 2>$null)
    return [ordered]@{
        os = [Environment]::OSVersion.VersionString
        ubr = $ubr
        cpu = $env:PROCESSOR_IDENTIFIER
        rustc = $rustc
        node = $node
        npm = $npmv
        ram_gb = $ramGb
        commit = $commit
    }
}

# ---- backup real user data ----
$script:hadSettings = Test-Path $SettingsPath
$script:hadDb = Test-Path $DbPath
if ($script:hadSettings) { Copy-Item $SettingsPath $Backup -Force }
$DbBackup = Join-Path $env:TEMP "rootup_scanpaths_db_backup"
Remove-Item $DbBackup -Recurse -Force -ErrorAction SilentlyContinue
if ($script:hadDb) {
    New-Item -ItemType Directory -Path $DbBackup | Out-Null
    foreach ($suffix in @("", "-wal", "-shm")) {
        $src = Join-Path $AppData ("rootup.db" + $suffix)
        if (Test-Path $src) { Copy-Item $src (Join-Path $DbBackup ("rootup.db" + $suffix)) -Force }
    }
}
Remove-Item $LogDir, $SnapDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $LogDir, $SnapDir -Force | Out-Null

$corpusPaths = @{}
try {
    if (-not $Root) {
        foreach ($size in $sizeList) {
            $raw = if ($CorpusDir) { Join-Path $CorpusDir ("corpus_" + $size) } else { Join-Path $env:TEMP ("rootup_scan_paths_corpus_" + $size) }
            $marker = $raw + ".prepared"
            if ((Test-Path $marker) -and (Test-Path $raw)) {
                Write-Host ("[scan-paths] reuse prepared corpus {0}" -f $raw)
            } else {
                Remove-Item $raw -Recurse -Force -ErrorAction SilentlyContinue
                New-Corpus $raw $size
                Set-Content -Path $marker -Value "1" -Encoding ASCII
            }
            $corpusPaths["$size"] = $raw
        }
    }
} catch {
    foreach ($key in $corpusPaths.Keys) {
        Remove-Item $corpusPaths[$key] -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item ($corpusPaths[$key] + ".prepared") -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $LogDir, $SnapDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $env:TEMP "rootup_scanpaths_db_backup") -Recurse -Force -ErrorAction SilentlyContinue
    throw
}

$script:report = [System.Collections.Generic.List[string]]::new()
$script:metrics = [ordered]@{}
$script:consistency = [ordered]@{}
$script:optimizer = [ordered]@{}
$script:dbCompare = [ordered]@{}
$script:scanFailures = 0

try {
    $script:report.Add("# 0.8.6 scan-path comparison (walkdir / native / MFT / optimizer)")
    $script:report.Add("")
    $script:report.Add("- Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $script:report.Add("- Host: $([Environment]::OSVersion.VersionString) (UBR $(try { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name UBR).UBR } catch { '?' }))")
    $script:report.Add("- Admin: $isAdmin")
    $script:report.Add("- Rounds: $Rounds")
    if ($Root) { $script:report.Add("- Corpus: real dir $Root") } else { $script:report.Add("- Corpus: generated, sizes $($sizeList -join ',')") }
    $script:report.Add("- Strict DB compare: $(-not $SkipDbCompare)")
    $script:report.Add("")
    $script:report.Add("| size | walkdir p50 (ms) | native p50 (ms) | MFT p50 (ms) | optimizer p50 (ms) | consistency |")
    $script:report.Add("| --- | --- | --- | --- | --- | --- |")

    if ($Root) { $sizeList = @(-1) }
    foreach ($size in $sizeList) {
        $rawDir = if ($Root) { $Root } else { $corpusPaths["$size"] }
        $label = if ($Root) { "real" } else { $size }
        $dir = Get-LongPath $rawDir

        $stateRounds = @{}
        foreach ($st in $states) { $stateRounds[$st] = [System.Collections.Generic.List[object]]::new() }
        $snap = @{}
        $okAll = $true

        for ($r = 0; $r -lt $Rounds; $r++) {
            foreach ($st in $states) {
                Write-Host ("[scan-paths] {0} {1} round {2}/{3}..." -f $label, $st, ($r + 1), $Rounds)
                $res = Invoke-OneScan $dir $st
                if (-not $res) {
                    Write-Host ("[scan-paths] {0} {1} round {2} TIMEOUT" -f $label, $st, ($r + 1)) -ForegroundColor Red
                    $okAll = $false
                    continue
                }
                $stateRounds[$st].Add($res)
                if (Test-Path $LogFile) {
                    Copy-Item $LogFile (Join-Path $LogDir ("{0}_{1}_{2}.log" -f $label, $st, $r)) -Force -ErrorAction SilentlyContinue
                }
                Write-Host ("[scan-paths] {0} {1} round {2} discovered={3} errors={4} elapsed={5}ms mftUsed={6}" -f $label, $st, ($r + 1), $res.discovered, $res.errors, $res.elapsed, $res.mftUsed)
            }
        }

        foreach ($st in $states) {
            if ($stateRounds[$st].Count -gt 0) {
                Save-Snapshot ("{0}_{1}" -f $label, $st)
                $snap[$st] = Join-Path $SnapDir ("{0}_{1}.db" -f $label, $st)
            }
        }

        $first = $null
        foreach ($st in $states) {
            if ($stateRounds[$st].Count -gt 0) { $first = $stateRounds[$st][0]; break }
        }
        $counts = [ordered]@{}
        $errors = [ordered]@{}
        $mftFlags = [ordered]@{}
        foreach ($st in $states) {
            $list = $stateRounds[$st]
            $elapsed = @($list | ForEach-Object { $_.elapsed })
            $script:metrics["scan_path_{0}_{1}_ms" -f $label, $st] = New-Stats $elapsed
            if ($st -eq "mft" -or $st -eq "optimizer") {
                $read = @($list | ForEach-Object { if ($null -ne $_.read_ms) { $_.read_ms } })
                if ($read.Count -gt 0) { $script:metrics["scan_path_{0}_{1}_mft_read_ms" -f $label, $st] = New-Stats $read }
            }
            if ($list.Count -gt 0) {
                $counts[$st] = ($list | ForEach-Object { $_.discovered } | Sort-Object -Unique) -join "/"
                $errors[$st] = ($list | ForEach-Object { $_.errors } | Sort-Object -Unique) -join "/"
                $mftFlags[$st] = ($list | ForEach-Object { $_.mftUsed } | Sort-Object -Unique) -join "/"
                if ($st -eq "optimizer" -and $list[0].decision) {
                    $script:optimizer["$label"] = $list[0].decision
                }
            }
        }

        $countOk = ($counts.Values | Sort-Object -Unique).Count -eq 1
        $errorOk = ($errors.Values | Sort-Object -Unique).Count -eq 1 -and ($errors.Values | Select-Object -First 1) -eq "0"
        $mftOk = $mftFlags["mft"] -eq "True"
        $dbOk = $true
        if (-not $SkipDbCompare) {
            $pairs = @(
                @("walkdir", "native"),
                @("native", "mft"),
                @("mft", "optimizer")
            )
            foreach ($pair in $pairs) {
                $a = $snap[$pair[0]]; $b = $snap[$pair[1]]
                if (-not $a -or -not $b) { $dbOk = $false; continue }
                $out = Join-Path $SnapDir ("compare_{0}_{1}_{2}.md" -f $label, $pair[0], $pair[1])
                & python $Compare $a $b $dir $out ("{0}:{1}->{2}" -f $label, $pair[0], $pair[1]) "strict"
                if ($LASTEXITCODE -ne 0) { $dbOk = $false }
                if (Test-Path $out) {
                    $row = (Get-Content $out -Raw).Trim()
                    if ($row) { $script:dbCompare["{0}_{1}_vs_{2}" -f $label, $pair[0], $pair[1]] = $row }
                }
            }
        }
        $stateOk = $countOk -and $errorOk -and $mftOk -and $dbOk
        if (-not $stateOk) { $script:scanFailures++ }
        $script:consistency["$label"] = [ordered]@{
            counts = $counts
            errors = $errors
            mft_used = $mftFlags
            counts_match = $countOk
            errors_zero = $errorOk
            mft_forced_used = $mftOk
            db_sets_match = $dbOk
        }

        $wp = P50 @($stateRounds["walkdir"] | ForEach-Object { $_.elapsed })
        $np = P50 @($stateRounds["native"] | ForEach-Object { $_.elapsed })
        $mp = P50 @($stateRounds["mft"] | ForEach-Object { $_.elapsed })
        $op = P50 @($stateRounds["optimizer"] | ForEach-Object { $_.elapsed })
        $script:report.Add("| $label | $wp | $np | $mp | $op | $stateOk |")
        Write-Host ("[scan-paths] {0} done: walk={1}ms native={2}ms mft={3}ms opt={4}ms ok={5}" -f $label, $wp, $np, $mp, $op, $stateOk)

        Remove-Item (Join-Path $SnapDir "*") -Force -ErrorAction SilentlyContinue
    }

    $script:report.Add("")
    $script:report.Add("## Optimizer decisions (fresh index, model defaults)")
    foreach ($k in $script:optimizer.Keys) {
        $d = $script:optimizer[$k]
        $script:report.Add("- $k : root_count=$($d.root_count) crossover=$($d.crossover) use_mft=$($d.use_mft) force_mft=$($d.force_mft)")
    }
    $script:report.Add("")
    $script:report.Add("## DB set comparison (strict)")
    if ($script:dbCompare.Count -eq 0) {
        $script:report.Add("- (skipped)")
    } else {
        foreach ($k in $script:dbCompare.Keys) {
            $script:report.Add("- $k : $($script:dbCompare[$k])")
        }
    }

    $full = Join-Path $Repo $OutFile
    [System.IO.File]::WriteAllLines($full, $script:report, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Report: $full"

    $json = [ordered]@{
        schema = 2
        version = "0.8.6"
        date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        host = Get-HostFingerprint
        scenario = [ordered]@{
            name = "scan_paths_v1"
            states = $states
            sizes = if ($Root) { @(-1) } else { $sizeList }
            rounds = $Rounds
            real_root = if ($Root) { $Root } else { "" }
            strict = (-not $SkipDbCompare)
        }
        metrics = $script:metrics
        consistency = $script:consistency
        optimizer = $script:optimizer
    }
    $jsonPath = Join-Path $Repo $JsonOut
    [System.IO.File]::WriteAllText(
        $jsonPath,
        ($json | ConvertTo-Json -Depth 12),
        (New-Object System.Text.UTF8Encoding($false))
    )
    Write-Host "JSON: $jsonPath"
    if ($script:scanFailures -gt 0) {
        Write-Host "Consistency failures: $script:scanFailures" -ForegroundColor Red
        exit 1
    }
} finally {
    Stop-RootUp
    Remove-Item Env:ROOTUP_MFT_SCAN, Env:ROOTUP_MFT_FORCE, Env:ROOTUP_ENUM -ErrorAction SilentlyContinue
    if (Test-Path $Backup) {
        Move-Item $Backup $SettingsPath -Force
    } elseif ($script:hadSettings) {
        Write-Host "[WARN] settings.json missing and no backup (original existed)" -ForegroundColor Yellow
    } else {
        Remove-Item $SettingsPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $DbBackup) {
        Clear-IndexDb
        foreach ($suffix in @("", "-wal", "-shm")) {
            $src = Join-Path $DbBackup ("rootup.db" + $suffix)
            if (Test-Path $src) { Copy-Item $src (Join-Path $AppData ("rootup.db" + $suffix)) -Force }
        }
        Remove-Item $DbBackup -Recurse -Force -ErrorAction SilentlyContinue
    } elseif ($script:hadDb) {
        Write-Host "[WARN] rootup.db missing and no DB backup (original existed)" -ForegroundColor Yellow
    } else {
        Clear-IndexDb
    }
    Remove-Item $SnapDir -Recurse -Force -ErrorAction SilentlyContinue
    if (-not $Root -and -not $KeepCorpus) {
        foreach ($size in $sizeList) {
            if ($corpusPaths.ContainsKey("$size")) {
                Remove-Item $corpusPaths["$size"] -Recurse -Force -ErrorAction SilentlyContinue
                Remove-Item ($corpusPaths["$size"] + ".prepared") -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
