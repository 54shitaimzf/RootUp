param(
    [string]$Sizes = "50000",
    [int]$Rounds = 1,
    [string]$Root = "C:\Users\Administrator\Desktop"
)

<#
  0.8.6 实验 A/C/D 一键验证（需管理员）：
  对 sequential / parallel 两种 MFT 读取策略（0.8.6 已落地 parallel；mftfile/nobuffer 结论见
  benchmarks\mft-read-variants.md），
  各跑合成 50k、边界语料、真实目录的三臂全链路对比（walkdir/native/MFT），
  汇总 read_ms、总耗时与严格零差异判定到 benchmarks\mft-read-variants.md。
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mft-read-variants.ps1
#>

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Enum = Join-Path $PSScriptRoot "enum-compare.ps1"
$SummaryFile = Join-Path $Repo "benchmarks\mft-read-variants.md"
$variants = @("sequential", "parallel")

$rows = [System.Collections.Generic.List[string]]::new()
$rows.Add("# MFT read variants comparison (0.8.6 A/C/D)")
$rows.Add("")
$rows.Add("- Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$rows.Add("- Host: $([Environment]::OSVersion.VersionString)")
$rows.Add("- Sizes: $Sizes ; Rounds: $Rounds ; Root: $Root")
$rows.Add("")
$rows.Add("| variant | corpus | walkdir ms | native ms | mft ms | mft read ms | walk-native | walk-mft | native-mft |")
$rows.Add("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")

$allOk = $true
foreach ($v in $variants) {
    $corpora = @(
        @{ Name = "synth-$Sizes"; Args = @("-Mft", "-MftRead", $v, "-Sizes", $Sizes, "-Rounds", $Rounds, "-OutFile", "benchmarks\enum-compare-$v.md") },
        @{ Name = "edge"; Args = @("-Mft", "-MftRead", $v, "-Edge", "-Rounds", 1, "-OutFile", "benchmarks\enum-compare-$v-edge.md") },
        @{ Name = "real"; Args = @("-Mft", "-MftRead", $v, "-Root", $Root, "-Rounds", 1, "-OutFile", "benchmarks\enum-compare-$v-real.md") }
    )
    foreach ($c in $corpora) {
        Write-Host ("=== variant={0} corpus={1} ===" -f $v, $c.Name)
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Enum @($c.Args) 2>&1
        $out | ForEach-Object { Write-Host $_ }
        $report = Join-Path $Repo $c.Args[$c.Args.IndexOf("-OutFile") + 1]
        $elapsed = @{}
        $readMs = $null
        $mftUsed = $null
        $verdicts = @{}
        if (Test-Path $report) {
            foreach ($line in Get-Content $report) {
                if ($line -match '^- elapsed_ms: (.+?) (\w+) = ([\d.]+)') {
                    $elapsed[$matches[2]] = [double]$matches[3]
                } elseif ($line -match '^- read_ms: (.+?) mft = ([\d.]+)') {
                    $readMs = [double]$matches[2]
                } elseif ($line -match '^- mft_used: (.+?) = (True|False)') {
                    $mftUsed = $matches[2]
                } elseif ($line -match '^\| ([\w-]+)-(walkdir|native|mft)-vs-(walkdir|native|mft) \|') {
                    $parts = $line.Trim('|').Split('|') | ForEach-Object { $_.Trim() }
                    $verdicts[($matches[2] + "-vs-" + $matches[3])] = $parts[$parts.Count - 1]
                }
            }
        }
        $wn = if ($verdicts.ContainsKey("walkdir-vs-native")) { $verdicts["walkdir-vs-native"] } else { "MISSING" }
        $wm = if ($verdicts.ContainsKey("walkdir-vs-mft")) { $verdicts["walkdir-vs-mft"] } else { "MISSING" }
        $nm = if ($verdicts.ContainsKey("native-vs-mft")) { $verdicts["native-vs-mft"] } else { "MISSING" }
        if ($mftUsed -eq "False") {
            $wm = "FALLBACK"
            $nm = "FALLBACK"
        }
        $walkMs = if ($elapsed.ContainsKey("walkdir")) { "{0:N0}" -f $elapsed["walkdir"] } else { "-" }
        $nativeMs = if ($elapsed.ContainsKey("native")) { "{0:N0}" -f $elapsed["native"] } else { "-" }
        $mftMs = if ($elapsed.ContainsKey("mft")) { "{0:N0}" -f $elapsed["mft"] } else { "-" }
        $readTxt = if ($null -ne $readMs) { "{0:N0}" -f $readMs } else { "-" }
        $rows.Add("| $v | $($c.Name) | $walkMs | $nativeMs | $mftMs | $readTxt | $wn | $wm | $nm |")
        if ($wn -ne "PASS" -or $wm -ne "PASS" -or $nm -ne "PASS") { $allOk = $false }
    }
}
[System.IO.File]::WriteAllLines($SummaryFile, $rows, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Summary: $SummaryFile"
if ($allOk) { Write-Host "RESULT: PASS" } else { Write-Host "RESULT: FAIL" }
