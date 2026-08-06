# Removes local benchmark/smoke/acceptance artifacts and restores safety checks.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

$temp = $env:TEMP
$patterns = @(
    "rootup_*",
    "rootup-*",
    "engine-*.json",
    "engine-v2-*.json"
)
foreach ($pattern in $patterns) {
    Get-ChildItem $temp -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like $pattern } |
        ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

$appData = Join-Path $env:APPDATA "com.rootup.desktop"
foreach ($backup in @(
    (Join-Path $appData "settings.json.bench.bak"),
    (Join-Path $appData "settings.json.smoke.bak"),
    (Join-Path $appData "rootup.db.bench.bak")
)) {
    if (Test-Path $backup) { Remove-Item $backup -Force -ErrorAction SilentlyContinue }
}

foreach ($report in @(
    (Join-Path $Repo "scripts\release-gate-report.log"),
    (Join-Path $Repo "scripts\smoke-summary.log"),
    (Join-Path $Repo "scripts\installer-verify.log")
)) {
    if (Test-Path $report) { Remove-Item $report -Force -ErrorAction SilentlyContinue }
}

$failures = 0
$leftovers = @(Get-ChildItem $temp -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "rootup_*" -or $_.Name -like "rootup-*" })
if ($leftovers.Count -gt 0) {
    Write-Host "[FAIL] Temp leftovers remain: $($leftovers.Count)"
    $failures++
} else {
    Write-Host "[PASS] No temp benchmark leftovers"
}

$running = Get-Process -Name rootup -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "[FAIL] RootUp still running"
    $failures++
} else {
    Write-Host "[PASS] No running RootUp"
}

$backupLeft = @(Get-ChildItem $appData -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*.bench.bak" -or $_.Name -like "*.smoke.bak" })
if ($backupLeft.Count -gt 0) {
    Write-Host "[FAIL] Backup files remain: $($backupLeft.Count)"
    $failures++
} else {
    Write-Host "[PASS] No backup files remain"
}

if ($failures -eq 0) { Write-Host "Cleanup PASS" } else { Write-Host "Cleanup FAIL" }
exit $failures
