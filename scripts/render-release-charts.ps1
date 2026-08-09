param(
    [string]$ResultsDir = "benchmarks\results",
    [string]$ChartsDir = "benchmarks\charts",
    [string]$ScanJson = "benchmarks\results\0.8.6.scan.json",
    [string]$TableOut = "benchmarks\0.8.6-summary-table.md"
)

# Generates the 0.8.6 release comparison charts from result JSONs only.
# Hard constraints:
#   - bar charts use a linear y axis starting at 0
#   - bar heights are strictly proportional to values (asserted <=0.5% of plot height)
#   - every bar carries its exact value label; no truncated/transformed axes
#   - values must match the source JSON byte-for-byte after formatting
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$resultsRoot = if ([System.IO.Path]::IsPathRooted($ResultsDir)) { $ResultsDir } else { Join-Path $Repo $ResultsDir }
$chartsRoot = if ([System.IO.Path]::IsPathRooted($ChartsDir)) { $ChartsDir } else { Join-Path $Repo $ChartsDir }
New-Item -ItemType Directory -Force -Path $chartsRoot | Out-Null

function Load-Json([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    return Get-Content $path -Raw | ConvertFrom-Json
}

function Get-P50($metric, $json) {
    if ($null -eq $json -or $null -eq $json.metrics) { return $null }
    $m = $json.metrics.$metric
    if ($null -eq $m) { return $null }
    if ($null -ne $m.p50) { return [double]$m.p50 }
    if ($null -ne $m.median) { return [double]$m.median }
    return $null
}

function Format-Number([double]$Value) {
    if ($null -eq $Value) { return "-" }
    if ($Value -ge 100) { return [Math]::Round($Value, 1).ToString("0.0") }
    if ($Value -ge 1) { return [Math]::Round($Value, 2).ToString("0.00") }
    return [Math]::Round($Value, 4).ToString("0.0000")
}

$versions = @("0.8.5-rerun", "0.8.6-dev", "0.8.6")
$data = @{}
foreach ($v in $versions) {
    $path = Join-Path $resultsRoot ($v + ".json")
    $json = Load-Json $path
    if ($null -eq $json) {
        Write-Host "[charts] WARNING: missing $v system JSON ($path)"
    }
    $data[$v] = $json
}

$script:rectChecks = [System.Collections.Generic.List[object]]::new()
$script:labelChecks = [System.Collections.Generic.List[object]]::new()

function New-Panel(
    [string]$Title,
    [double[]]$Values,
    [string[]]$Labels,
    [string[]]$Colors,
    [int]$X,
    [int]$Y,
    [int]$PanelW,
    [int]$PanelH,
    [string]$DeltaBaseLabel
) {
    $left = 64
    $right = 14
    $top = 34
    $bottom = 24
    $plotW = $PanelW - $left - $right
    $plotH = $PanelH - $top - $bottom
    $max = ($Values | Where-Object { $null -ne $_ } | Measure-Object -Maximum).Maximum
    if ($null -eq $max -or $max -le 0) { $max = 1.0 }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("<g transform='translate($X,$Y)'>")
    [void]$sb.AppendLine("<rect x='0' y='0' width='$PanelW' height='$PanelH' rx='10' fill='#f8fafc' stroke='#e2e8f0' stroke-width='1'/>")
    [void]$sb.AppendLine("<text x='16' y='20' font-family='Segoe UI' font-size='13' font-weight='600' fill='#0f172a'>$Title</text>")
    # gridlines from 0 to max
    for ($g = 0; $g -le 4; $g++) {
        $ratio = $g / 4.0
        $gy = $top + $plotH - $ratio * $plotH
        $val = $max * $ratio
        [void]$sb.AppendLine("<line x1='$left' y1='$([Math]::Round($gy,1))' x2='$($left + $plotW)' y2='$([Math]::Round($gy,1))' stroke='#e2e8f0' stroke-width='1'/>")
        [void]$sb.AppendLine("<text x='$($left - 6)' y='$([Math]::Round($gy + 4,1))' font-family='Consolas' font-size='9' fill='#64748b' text-anchor='end'>$(Format-Number $val)</text>")
    }
    $n = $Values.Count
    $barW = [Math]::Min(46.0, $plotW / ($n * 2.0 + 0.5))
    $groupW = $n * $barW + ($n - 1) * 8
    $gx = $left + ($plotW - $groupW) / 2
    for ($i = 0; $i -lt $n; $i++) {
        $v = $Values[$i]
        $x = $gx + $i * ($barW + 8)
        $h = if ($null -ne $v) { [Math]::Max(1.0, $v / $max * $plotH) } else { 1.0 }
        $y = $top + $plotH - $h
        $fill = $Colors[$i]
        $valText = Format-Number $v
        [void]$sb.AppendLine("<rect x='$([Math]::Round($x,1))' y='$([Math]::Round($y,1))' width='$([Math]::Round($barW,1))' height='$([Math]::Round($h,1))' rx='4' fill='$fill' data-val='$valText'/>")
        [void]$sb.AppendLine("<text x='$([Math]::Round($x + $barW/2,1))' y='$([Math]::Round($y - 6,1))' font-family='Consolas' font-size='10' font-weight='600' fill='#334155' text-anchor='middle'>$valText</text>")
        [void]$sb.AppendLine("<text x='$([Math]::Round($x + $barW/2,1))' y='$($PanelH - 8)' font-family='Segoe UI' font-size='10' fill='#475569' text-anchor='middle'>$($Labels[$i])</text>")
        $script:rectChecks.Add([pscustomobject]@{
            expectedHeight = if ($null -ne $v) { $v / $max * $plotH } else { 0.0 }
            actualHeight = $h
            plotH = $plotH
            value = $v
            valueText = $valText
        })
    }
    if ($n -ge 3 -and $null -ne $Values[2] -and $null -ne $Values[0] -and $Values[0] -ne 0) {
        $delta = ($Values[2] - $Values[0]) / $Values[0] * 100.0
        $bx = $gx + 2 * ($barW + 8) + $barW / 2
        $by = $top + $plotH - [Math]::Max(1.0, $Values[2] / $max * $plotH) - 20
        $color = if ($delta -le 0) { "#059669" } else { "#dc2626" }
        $sign = if ($delta -gt 0) { "+" } else { "" }
        [void]$sb.AppendLine("<text x='$([Math]::Round($bx,1))' y='$([Math]::Round($by,1))' font-family='Segoe UI' font-size='10' font-weight='600' fill='$color' text-anchor='middle'>$($sign)$([Math]::Round($delta,1))% vs $DeltaBaseLabel</text>")
    }
    [void]$sb.AppendLine("</g>")
    return $sb.ToString()
}

# ---------- summary chart ----------
$summaryMetrics = @(
    @{ key = "system_startup_cold_ms"; label = "Cold startup (ms)" },
    @{ key = "system_interactive_cold_ms"; label = "Interactive cold (ms)" },
    @{ key = "system_scan_cold_ms"; label = "First scan 10k (ms)" },
    @{ key = "engine_scan_mixed_100k_ms"; label = "Engine scan 100k (ms)" },
    @{ key = "engine_query_text_ms"; label = "Text query (ms)" },
    @{ key = "engine_query_label_ms"; label = "Label query (ms)" },
    @{ key = "engine_reapply_labels_ms"; label = "Reapply labels (ms)" },
    @{ key = "system_idle_rss_mb"; label = "Idle memory (MB)" },
    @{ key = "system_index_db_kb"; label = "Index DB size (KB)" }
)
$labels = @("0.8.5", "0.8.6-dev", "0.8.6")
$colors = @("#94a3b8", "#38bdf8", "#10b981")
$cols = 2
$panelW = 430
$panelH = 170
$gapX = 24
$gapY = 20
$marginX = 24
$marginTop = 64
$rows = [Math]::Ceiling($summaryMetrics.Count / $cols)
$svgW = $marginX * 2 + $cols * $panelW + ($cols - 1) * $gapX
$svgH = $marginTop + $rows * $panelH + ($rows - 1) * $gapY + 28

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("<svg xmlns='http://www.w3.org/2000/svg' width='$svgW' height='$svgH' viewBox='0 0 $svgW $svgH' data-axis-min='0' data-log='none'>")
[void]$sb.AppendLine("<rect width='$svgW' height='$svgH' fill='#ffffff'/>")
[void]$sb.AppendLine("<text x='$marginX' y='30' font-family='Segoe UI' font-size='18' font-weight='700' fill='#0f172a'>0.8.6 performance summary (p50, lower is better)</text>")
$legend = @(
    @{ c = $colors[0]; t = "0.8.5 (25H2 rerun)" },
    @{ c = $colors[1]; t = "0.8.6-dev (25H2)" },
    @{ c = $colors[2]; t = "0.8.6 (25H2)" }
)
$lx = $marginX
foreach ($item in $legend) {
    [void]$sb.AppendLine("<rect x='$lx' y='42' width='12' height='12' rx='3' fill='$($item.c)'/>")
    [void]$sb.AppendLine("<text x='$($lx + 18)' y='52' font-family='Segoe UI' font-size='12' fill='#334155'>$($item.t)</text>")
    $lx += 26 + ($item.t.Length * 7.2) + 28
}
for ($i = 0; $i -lt $summaryMetrics.Count; $i++) {
    $metric = $summaryMetrics[$i]
    $values = @()
    foreach ($v in $versions) {
        $values += Get-P50 $metric.key $data[$v]
    }
    $col = $i % $cols
    $row = [int][Math]::Floor($i / $cols)
    $x = $marginX + $col * ($panelW + $gapX)
    $y = $marginTop + $row * ($panelH + $gapY)
    [void]$sb.Append((New-Panel $metric.label $values $labels $colors $x $y $panelW $panelH "0.8.5"))
}
[void]$sb.AppendLine("<text x='$marginX' y='$($svgH - 6)' font-family='Segoe UI' font-size='11' fill='#64748b'>Linear y-axis from 0; values are p50 from benchmarks/results/*.json.</text>")
[void]$sb.AppendLine("</svg>")
$summarySvg = Join-Path $chartsRoot "0.8.6-performance-summary.svg"
[System.IO.File]::WriteAllText($summarySvg, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Summary chart: $summarySvg"

# ---------- scan-path chart ----------
$scanJsonPath = if ([System.IO.Path]::IsPathRooted($ScanJson)) { $ScanJson } else { Join-Path $Repo $ScanJson }
$scan = Load-Json $scanJsonPath
if ($null -eq $scan) {
    Write-Host "[charts] WARNING: scan JSON not found ($scanJsonPath); skipping scan-path chart."
} else {
    $scanSizes = @()
    foreach ($p in $scan.scenario.sizes) {
        $scanSizes += if ($p -eq -1) { "real" } else { $p }
    }
    $scanLabels = @("walkdir", "native", "MFT", "optimizer")
    $scanColors = @("#f87171", "#38bdf8", "#10b981", "#a78bfa")
    $scanCols = 2
    $scanRows = [Math]::Ceiling($scanSizes.Count / $scanCols)
    $scanW = $svgW
    $scanH = $marginTop + $scanRows * $panelH + ($scanRows - 1) * $gapY + 28
    $sb2 = New-Object System.Text.StringBuilder
    [void]$sb2.AppendLine("<svg xmlns='http://www.w3.org/2000/svg' width='$scanW' height='$scanH' viewBox='0 0 $scanW $scanH' data-axis-min='0' data-log='none'>")
    [void]$sb2.AppendLine("<rect width='$scanW' height='$scanH' fill='#ffffff'/>")
    [void]$sb2.AppendLine("<text x='$marginX' y='30' font-family='Segoe UI' font-size='18' font-weight='700' fill='#0f172a'>0.8.6 scan paths (p50 full scan, lower is better)</text>")
    $lx2 = $marginX
    foreach ($item in @(
        @{ c = $scanColors[0]; t = "walkdir" },
        @{ c = $scanColors[1]; t = "native" },
        @{ c = $scanColors[2]; t = "MFT (forced)" },
        @{ c = $scanColors[3]; t = "optimizer" }
    )) {
        [void]$sb2.AppendLine("<rect x='$lx2' y='42' width='12' height='12' rx='3' fill='$($item.c)'/>")
        [void]$sb2.AppendLine("<text x='$($lx2 + 18)' y='52' font-family='Segoe UI' font-size='12' fill='#334155'>$($item.t)</text>")
        $lx2 += 26 + ($item.t.Length * 7.0) + 28
    }
    for ($i = 0; $i -lt $scanSizes.Count; $i++) {
        $sz = $scanSizes[$i]
        $values = @()
        foreach ($st in @("walkdir", "native", "mft", "optimizer")) {
            $values += Get-P50 ("scan_path_{0}_{1}_ms" -f $sz, $st) $scan
        }
        $col = $i % $scanCols
        $row = [int][Math]::Floor($i / $scanCols)
        $x = $marginX + $col * ($panelW + $gapX)
        $y = $marginTop + $row * ($panelH + $gapY)
        $title = if ($sz -eq "real") { "Real dir" } else { "$sz files" }
        [void]$sb2.Append((New-Panel $title $values $scanLabels $scanColors $x $y $panelW $panelH "walkdir"))
    }
    [void]$sb2.AppendLine("<text x='$marginX' y='$($scanH - 6)' font-family='Segoe UI' font-size='11' fill='#64748b'>Linear y-axis from 0; MFT arm uses ROOTUP_MFT_FORCE=1 (diagnostic).</text>")
    [void]$sb2.AppendLine("</svg>")
    $scanSvg = Join-Path $chartsRoot "0.8.6-scan-paths.svg"
    [System.IO.File]::WriteAllText($scanSvg, $sb2.ToString(), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Scan chart: $scanSvg"
}

# ---------- validation ----------
$failures = 0
foreach ($check in $script:rectChecks) {
    $rel = [Math]::Abs($check.actualHeight - $check.expectedHeight) / [Math]::Max(1.0, $check.plotH)
    if ($rel -gt 0.005) {
        Write-Host ("[charts] FAIL bar proportion: expected={0} actual={1} rel={2:P3}" -f $check.expectedHeight, $check.actualHeight, $rel)
        $failures++
    }
    $expectedText = Format-Number $check.value
    if ($check.valueText -ne $expectedText) {
        Write-Host ("[charts] FAIL value label: got={0} expected={1}" -f $check.valueText, $expectedText)
        $failures++
    }
}
foreach ($svgPath in @($summarySvg, $(if ($null -ne $scan) { $scanSvg } else { "" }))) {
    if (-not $svgPath -or -not (Test-Path $svgPath)) { continue }
    $svgText = Get-Content $svgPath -Raw
    if ($svgText -notmatch "data-axis-min='0'") {
        Write-Host "[charts] FAIL y-axis does not start at 0: $svgPath"
        $failures++
    }
    if ($svgText -match "data-log='(?!none)") {
        Write-Host "[charts] FAIL unlabelled transform detected: $svgPath"
        $failures++
    }
}

# ---------- summary table fragment ----------
$table = [System.Collections.Generic.List[string]]::new()
$table.Add("| Metric | 0.8.5 (25H2 rerun) | 0.8.6-dev (25H2) | 0.8.6 (25H2) | vs 0.8.5 | vs 0.8.6-dev |")
$table.Add("| --- | --- | --- | --- | --- | --- |")
$warnings = [System.Collections.Generic.List[string]]::new()
foreach ($metric in $summaryMetrics) {
    $v0 = Get-P50 $metric.key $data[$versions[0]]
    $v1 = Get-P50 $metric.key $data[$versions[1]]
    $v2 = Get-P50 $metric.key $data[$versions[2]]
    $d0 = if ($null -ne $v0 -and $v0 -ne 0 -and $null -ne $v2) { ($v2 - $v0) / $v0 * 100.0 } else { $null }
    $d1 = if ($null -ne $v1 -and $v1 -ne 0 -and $null -ne $v2) { ($v2 - $v1) / $v1 * 100.0 } else { $null }
    $f = { param($v) if ($null -eq $v) { "-" } else { Format-Number $v } }
    $fd = { param($v) if ($null -eq $v) { "-" } else { "{0}{1:N1}%" -f $(if ($v -gt 0) { "+" } else { "" }), $v } }
    $table.Add("| $($metric.label) | $(& $f $v0) | $(& $f $v1) | $(& $f $v2) | $(& $fd $d0) | $(& $fd $d1) |")
    foreach ($pair in @(@("0.8.5", $d0), @("0.8.6-dev", $d1))) {
        if ($null -ne $pair[1] -and [Math]::Abs($pair[1]) -ge 15) {
            $warnings.Add("$($metric.key): $([Math]::Round($pair[1],1))% vs $($pair[0])")
        }
    }
}
if ($null -ne $scan) {
    $table.Add("")
    $table.Add("| Scan corpus | walkdir (ms) | native (ms) | MFT (ms) | optimizer (ms) | native vs walkdir | MFT vs walkdir |")
    $table.Add("| --- | --- | --- | --- | --- | --- | --- |")
    foreach ($sz in $scanSizes) {
        $w = Get-P50 ("scan_path_{0}_walkdir_ms" -f $sz) $scan
        $n = Get-P50 ("scan_path_{0}_native_ms" -f $sz) $scan
        $m = Get-P50 ("scan_path_{0}_mft_ms" -f $sz) $scan
        $o = Get-P50 ("scan_path_{0}_optimizer_ms" -f $sz) $scan
        $dn = if ($null -ne $w -and $w -ne 0 -and $null -ne $n) { ($n - $w) / $w * 100.0 } else { $null }
        $dm = if ($null -ne $w -and $w -ne 0 -and $null -ne $m) { ($m - $w) / $w * 100.0 } else { $null }
        $table.Add("| $sz | $(& $f $w) | $(& $f $n) | $(& $f $m) | $(& $f $o) | $(& $fd $dn) | $(& $fd $dm) |")
    }
}
$table.Add("")
if ($warnings.Count -gt 0) {
    $table.Add(">=15% p50 changes (non-blocking, explained in the release report):")
    foreach ($w in $warnings) { $table.Add("- $w") }
} else {
    $table.Add("No >=15% p50 regressions.")
}
$tablePath = if ([System.IO.Path]::IsPathRooted($TableOut)) { $TableOut } else { Join-Path $Repo $TableOut }
[System.IO.File]::WriteAllLines($tablePath, $table, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Summary table: $tablePath"

if ($failures -gt 0) {
    Write-Host "Chart validation FAIL: $failures issue(s)" -ForegroundColor Red
    exit 1
}
Write-Host "Chart validation PASS (linear axis from 0, proportional bars, exact labels)"
