# Validates that every GFM table has a consistent column count across its
# header separator and body rows. Scans repo README, benchmarks README and all
# docs/*.md by default; pass -Paths to override.
param(
    [string[]]$Paths = @()
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

if ($Paths.Count -eq 0) {
    $Paths = @(
        "README.md",
        "benchmarks\README.md"
    ) + @(Get-ChildItem (Join-Path $Repo "docs") -Recurse -Filter *.md | ForEach-Object { $_.FullName })
}

$failures = 0
foreach ($p in $Paths) {
    $full = if ([System.IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $Repo $p }
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $lines = Get-Content -LiteralPath $full -Encoding UTF8
    $i = 0
    $inFence = $false
    while ($i -lt $lines.Count) {
        if ($lines[$i].Trim() -match '^```') {
            $inFence = -not $inFence
            $i++
            continue
        }
        if ($inFence) {
            $i++
            continue
        }
        $trimmed = $lines[$i].Trim()
        if ($trimmed -notmatch '^\|') {
            $i++
            continue
        }
        $start = $i
        $table = [System.Collections.Generic.List[string]]::new()
        while ($i -lt $lines.Count -and $lines[$i].Trim() -match '^\|') {
            $table.Add($lines[$i].Trim())
            $i++
        }
        if ($table.Count -lt 2) {
            Write-Host "[FAIL] $full line $($start + 1): table needs header + separator"
            $failures++
            continue
        }
        $header = $table[0]
        $separator = $table[1]
        $cols = @([regex]::Matches($header, '\\?\|')).Count - 2
        if ($separator -notmatch '^[\|:\-\s]+$') {
            Write-Host "[FAIL] $full line $($start + 2): invalid separator '$separator'"
            $failures++
        }
        for ($r = 2; $r -lt $table.Count; $r++) {
            $rowCols = @([regex]::Matches($table[$r], '\\?\|')).Count - 2
            if ($rowCols -ne $cols) {
                Write-Host "[FAIL] $full line $($start + $r + 1): row has $rowCols columns, header has $cols"
                $failures++
            }
        }
    }
}

if ($failures -eq 0) {
    Write-Host "Markdown table alignment PASS"
} else {
    Write-Host "Markdown table alignment FAIL: $failures issue(s)"
}
exit $failures
