param(
    [string]$ResultsDir = "benchmarks\results",
    [string]$OutDir = "benchmarks",
    [switch]$Sample
)

# Renders committed benchmark JSON history (schema v1 + v2) into README tables
# and SVG trend charts. Local-only, no external chart library.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

if ($Sample) {
    $tmp = Join-Path $env:TEMP ("rootup_bench_sample_" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path (Join-Path $tmp "results") | Out-Null
    $sampleData = @(
        @{
            schema = 2
            version = "0.8.3"
            host = @{
                os = "Microsoft Windows NT 10.0.22621.0"
                cpu = "Sample CPU"
                rustc = "rustc 1.97.1 (sample)"
                node = "v22.0.0"
                npm = "10.0.0"
                ram_gb = 32
                commit = "sample-a"
            }
            metrics = @{
                engine_scan_mixed_10k_ms = @{ unit = "ms"; p50 = 120.0; p90 = 140.0; p99 = 160.0; min = 110.0; max = 170.0; mean = 125.0; cv = 0.1; samples = 5 }
                engine_scan_mixed_10k_per_file_ms = @{ unit = "ms/file"; p50 = 0.0289; p90 = 0.0312; p99 = 0.0340; min = 0.0270; max = 0.0350; mean = 0.0295; cv = 0.06; samples = 5 }
                system_startup_log_ms = @{ unit = "ms"; p50 = 300.0; p90 = 340.0; p99 = 380.0; min = 290.0; max = 400.0; mean = 320.0; cv = 0.08; samples = 5 }
            }
        },
        @{
            schema = 2
            version = "0.8.4"
            host = @{
                os = "Microsoft Windows NT 10.0.22621.0"
                cpu = "Sample CPU"
                rustc = "rustc 1.97.1 (sample)"
                node = "v22.0.0"
                npm = "10.0.0"
                ram_gb = 32
                commit = "sample-b"
            }
            metrics = @{
                engine_scan_mixed_10k_ms = @{ unit = "ms"; p50 = 95.0; p90 = 115.0; p99 = 145.0; min = 90.0; max = 155.0; mean = 100.0; cv = 0.09; samples = 5 }
                engine_scan_mixed_10k_per_file_ms = @{ unit = "ms/file"; p50 = 0.0256; p90 = 0.0280; p99 = 0.0300; min = 0.0240; max = 0.0310; mean = 0.0261; cv = 0.07; samples = 5 }
                system_startup_log_ms = @{ unit = "ms"; p50 = 280.0; p90 = 310.0; p99 = 350.0; min = 270.0; max = 380.0; mean = 290.0; cv = 0.07; samples = 5 }
            }
        },
        @{
            schema = 2
            version = "0.8.5"
            host = @{
                os = "Microsoft Windows NT 10.0.22621.0"
                cpu = "Different CPU"
                rustc = "rustc 1.97.1 (sample)"
                node = "v22.0.0"
                npm = "10.0.0"
                ram_gb = 64
                commit = "sample-c"
            }
            metrics = @{
                engine_scan_mixed_10k_ms = @{ unit = "ms"; p50 = 80.0; p90 = 100.0; p99 = 130.0; min = 75.0; max = 140.0; mean = 85.0; cv = 0.08; samples = 5 }
                engine_scan_mixed_10k_per_file_ms = @{ unit = "ms/file"; p50 = 0.0220; p90 = 0.0240; p99 = 0.0280; min = 0.0210; max = 0.0290; mean = 0.0230; cv = 0.06; samples = 5 }
                system_startup_log_ms = @{ unit = "ms"; p50 = 260.0; p90 = 290.0; p99 = 330.0; min = 250.0; max = 360.0; mean = 270.0; cv = 0.06; samples = 5 }
            }
        }
    )
    foreach ($item in $sampleData) {
        $path = Join-Path $tmp ("results\" + $item.version + ".json")
        [System.IO.File]::WriteAllText(
            $path,
            ($item | ConvertTo-Json -Depth 8),
            (New-Object System.Text.UTF8Encoding $false)
        )
    }
    $ResultsDir = Join-Path $tmp "results"
    $OutDir = Join-Path $tmp "out"
}

$ResultsRoot = if ([System.IO.Path]::IsPathRooted($ResultsDir)) { $ResultsDir } else { Join-Path $Repo $ResultsDir }
$OutRoot = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $Repo $OutDir }
if (-not (Test-Path $ResultsRoot)) { throw "Results dir not found: $ResultsRoot" }

$files = @(Get-ChildItem $ResultsRoot -Filter "*.json" |
    Where-Object { $_.Name -notlike "*.engine.json" } |
    Sort-Object Name)
if ($files.Count -eq 0) { throw "No benchmark result files found in $ResultsRoot" }

function Get-VersionParts([string]$Version) {
    $isPrerelease = $Version -match '-'
    $parts = @($Version -split '[.\-+]' | ForEach-Object {
        $num = 0
        [int]::TryParse($_, [ref]$num) | Out-Null
        $num
    })
    # Pre-release/dev versions sort before the final release of the same number.
    $parts += $(if ($isPrerelease) { 0 } else { 1 })
    return $parts
}

function Get-FingerprintKey($hostInfo) {
    if ($null -eq $hostInfo) { return "unknown" }
    $os = [string]$hostInfo.os
    $cpu = [string]$hostInfo.cpu
    $rustc = [string]$hostInfo.rustc
    $ram = [string]$hostInfo.ram_gb
    if (-not $os -or -not $cpu -or -not $rustc -or -not $ram) { return "unknown" }
    return "$os|$cpu|$rustc|$ram"
}

$data = @()
foreach ($file in $files) {
    $json = Get-Content $file.FullName -Raw | ConvertFrom-Json
    $data += [pscustomobject]@{
        version = [string]$json.version
        json = $json
    }
}
$data = @($data | Sort-Object @{ Expression = {
    $parts = Get-VersionParts $_.version
    ($parts | ForEach-Object { $_.ToString("D5") }) -join "."
}})

$metricNames = @{}
$groups = [ordered]@{}
foreach ($entry in $data) {
    foreach ($prop in $entry.json.metrics.PSObject.Properties) {
        $metricNames[$prop.Name] = $true
        $prefix = ($prop.Name -split "_")[0]
        $group = if ($prefix -eq "engine" -or $prefix -eq "system") { $prefix } else { "other" }
        if (-not $groups.Contains($group)) { $groups[$group] = [System.Collections.Generic.List[string]]::new() }
        if (-not $groups[$group].Contains($prop.Name)) { $groups[$group].Add($prop.Name) }
    }
}

New-Item -ItemType Directory -Force -Path (Join-Path $OutRoot "charts") | Out-Null

function Get-Value($metric, $entry, [string]$Key) {
    $value = $entry.json.metrics.$metric
    if ($null -eq $value) { return $null }
    if ($Key -eq "p50") {
        if ($null -ne $value.p50) { return [double]$value.p50 }
        if ($null -ne $value.median) { return [double]$value.median }
        return $null
    }
    if ($Key -eq "p90") { if ($null -ne $value.p90) { return [double]$value.p90 } }
    if ($Key -eq "p99") { if ($null -ne $value.p99) { return [double]$value.p99 } }
    return $null
}

function Format-Number([double]$Value) {
    if ($Value -ge 100) { return [Math]::Round($Value, 1).ToString("0.0") }
    if ($Value -ge 1) { return [Math]::Round($Value, 2).ToString("0.00") }
    return [Math]::Round($Value, 4).ToString("0.0000")
}

function New-Chart([string]$Name, [object[]]$Points, [string]$Unit, [string]$ValueKey) {
    if ($Points.Count -lt 1) { return }
    $width = [Math]::Max(560, 130 * $Points.Count)
    $height = 260
    $left = 70
    $right = 20
    $top = 30
    $bottom = 46
    $plotW = $width - $left - $right
    $plotH = $height - $top - $bottom
    $min = ($Points | Measure-Object -Property value -Minimum).Minimum
    $max = ($Points | Measure-Object -Property value -Maximum).Maximum
    if ($max -gt $min) {
        $pad = [Math]::Max(1, ($max - $min) * 0.1)
    } else {
        $pad = [Math]::Max(1e-9, [Math]::Abs($max) * 0.1)
    }
    $min -= $pad
    $max += $pad

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("<svg xmlns='http://www.w3.org/2000/svg' width='$width' height='$height' viewBox='0 0 $width $height'>")
    [void]$sb.AppendLine("<rect width='$width' height='$height' fill='#ffffff'/>")
    [void]$sb.AppendLine("<text x='$left' y='18' font-family='Segoe UI' font-size='13' fill='#0f172a'>$Name ($ValueKey, $Unit)</text>")
    for ($g = 0; $g -le 4; $g++) {
        $ratio = $g / 4.0
        $y = $top + $plotH - $ratio * $plotH
        $val = $min + $ratio * ($max - $min)
        [void]$sb.AppendLine("<line x1='$left' y1='$y' x2='$($width - $right)' y2='$y' stroke='#e2e8f0' stroke-width='1'/>")
        [void]$sb.AppendLine("<text x='$($left - 6)' y='$($y + 4)' font-family='Consolas' font-size='10' fill='#64748b' text-anchor='end'>$(Format-Number $val)</text>")
    }
    $coords = @()
    for ($i = 0; $i -lt $Points.Count; $i++) {
        $x = $left + ($i / [Math]::Max(1, $Points.Count - 1)) * $plotW
        $y = $top + $plotH - (($Points[$i].value - $min) / ($max - $min)) * $plotH
        $coords += [pscustomobject]@{ x = $x; y = $y; p = $Points[$i] }
    }
    $poly = ($coords | ForEach-Object { "$([Math]::Round($_.x,1)),$([Math]::Round($_.y,1))" }) -join " "
    [void]$sb.AppendLine("<polyline points='$poly' fill='none' stroke='#10b981' stroke-width='2'/>")
    foreach ($c in $coords) {
        [void]$sb.AppendLine("<circle cx='$([Math]::Round($c.x,1))' cy='$([Math]::Round($c.y,1))' r='3.5' fill='#10b981'/>")
        [void]$sb.AppendLine("<text x='$([Math]::Round($c.x,1))' y='$([Math]::Round($c.y - 8,1))' font-family='Consolas' font-size='10' fill='#334155' text-anchor='middle'>$(Format-Number $c.p.value)</text>")
        [void]$sb.AppendLine("<text x='$([Math]::Round($c.x,1))' y='$($height - 24)' font-family='Consolas' font-size='10' fill='#334155' text-anchor='middle'>$($c.p.version)</text>")
    }
    [void]$sb.AppendLine("</svg>")
    return $sb.ToString()
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Performance Benchmarks")
$lines.Add("")
$lines.Add("> Generated by scripts/render-benchmarks.ps1 with the custom benchmark harness (local-only, same machine).")
$lines.Add("> Comparison rule: a p50 change of >=15% versus the previous version is flagged as a warning (non-blocking).")
$lines.Add("> Comparisons are computed only between versions with the same host fingerprint (os|cpu|rustc|ram_gb). Different or unknown fingerprints are displayed without a delta.")
$lines.Add("")
foreach ($entry in $data) {
    $schema = if ($entry.json.schema -eq 2) { "v2" } else { "v1" }
    $hostInfo = $entry.json.host
    $hostText = if ($hostInfo) { "$($hostInfo.os) | $($hostInfo.cpu)" } else { "unknown" }
    $ubrText = if ($hostInfo -and $hostInfo.ubr) { " | UBR $($hostInfo.ubr)" } else { "" }
    $commitText = if ($hostInfo.commit) { " | commit $($hostInfo.commit)" } else { "" }
    $lines.Add("- **$($entry.version)** ($schema) - $hostText$ubrText$commitText")
}
$lines.Add("")

$warnings = [System.Collections.Generic.List[string]]::new()
foreach ($group in $groups.Keys | Sort-Object) {
    $lines.Add("## $group")
    $lines.Add("")
    $header = "| metric |"
    $separator = "|---|"
    foreach ($entry in $data) {
        $header += " $($entry.version) (p50/p90/p99) |"
        $separator += "---|"
    }
    $lines.Add($header)
    $lines.Add($separator)
    foreach ($metric in $groups[$group]) {
        $row = "| $metric |"
        $lastByFp = @{}
        foreach ($entry in $data) {
            $p50 = Get-Value $metric $entry "p50"
            if ($null -eq $p50) {
                $row += " - |"
                continue
            }
            $p90 = Get-Value $metric $entry "p90"
            $p99 = Get-Value $metric $entry "p99"
            $p50Text = Format-Number $p50
            $p90Text = if ($null -eq $p90) { "-" } else { Format-Number $p90 }
            $p99Text = if ($null -eq $p99) { "-" } else { Format-Number $p99 }
            $fp = Get-FingerprintKey $entry.json.host
            $previousEntry = $lastByFp[$fp]
            if ($fp -eq "unknown" -or $null -eq $previousEntry) {
                $row += " $p50Text / $p90Text / $p99Text |"
            } else {
                $delta = ($p50 - $previousEntry.p50) / $previousEntry.p50 * 100
                $flag = if ([Math]::Abs($delta) -ge 15) { " :warning:" } else { "" }
                if ([Math]::Abs($delta) -ge 15) {
                    $warnings.Add("$metric $($entry.version): $([Math]::Round($delta,1))% vs $($previousEntry.version)")
                }
                $row += " $p50Text / $p90Text / $p99Text ($([Math]::Round($delta,1))%)$flag |"
            }
            if ($fp -ne "unknown") {
                $lastByFp[$fp] = @{ p50 = $p50; version = $entry.version }
            }
        }
        $lines.Add($row)
    }
    $lines.Add("")
}

$lines.Add("## Trend charts")
$lines.Add("")
foreach ($metric in ($metricNames.Keys | Sort-Object)) {
    $file = ($metric -replace '[^A-Za-z0-9_-]', '_')
    $lines.Add("- [$metric p50](charts/$file.svg)  | [p90](charts/$file.p90.svg)")
}
$lines.Add("")
$lines.Add("> Lower is better for ms/MB/KB metrics; higher is better for files/s.")

$readmePath = Join-Path $OutRoot "README.md"
[System.IO.File]::WriteAllLines(
    $readmePath,
    $lines,
    (New-Object System.Text.UTF8Encoding $false)
)

foreach ($metric in ($metricNames.Keys | Sort-Object)) {
    foreach ($valueKey in @("p50", "p90")) {
        $points = @()
        foreach ($entry in $data) {
            $value = Get-Value $metric $entry $valueKey
            if ($null -ne $value) {
                $points += [pscustomobject]@{ version = $entry.version; value = $value }
            }
        }
        if ($points.Count -lt 1) { continue }
        $unit = $data[0].json.metrics.$metric.unit
        $svg = New-Chart $metric $points $unit $valueKey
        $file = ($metric -replace '[^A-Za-z0-9_-]', '_') + $(if ($valueKey -eq "p90") { ".p90.svg" } else { ".svg" })
        [System.IO.File]::WriteAllText(
            (Join-Path $OutRoot ("charts\" + $file)),
            $svg,
            (New-Object System.Text.UTF8Encoding $false)
        )
    }
}

Write-Host "Rendered $($metricNames.Count) metrics across $($data.Count) versions"
Write-Host "README: $readmePath"
Write-Host "Charts: $(Join-Path $OutRoot 'charts')"
if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "Warnings (>=15% p50 change):"
    foreach ($w in $warnings) { Write-Host "  [WARN] $w" }
}
if ($Sample) {
    $readmeText = Get-Content $readmePath -Raw
    if ($warnings.Count -ne 1) {
        throw "Sample fingerprint comparison failed: expected exactly 1 same-host warning, got $($warnings.Count)"
    }
    if ($readmeText -notmatch 'Comparisons are computed only between versions') {
        throw "Sample README missing comparability note"
    }
}
if ($Sample) {
    Write-Host ""
    Write-Host "Sample outputs: $OutRoot"
}
