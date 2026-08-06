param(
    [switch]$SkipAgent,
    [switch]$Bench
)

# Mandatory pre-release gate: full automated checks plus the AI real-scenario
# acceptance (deep-link intents, screenshots, logs). Must run on a machine with
# a desktop session (agent acceptance launches the release app).
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Results = [System.Collections.Generic.List[string]]::new()
$script:Failures = 0

function Invoke-Check([string]$Name, [scriptblock]$Body) {
    Write-Host ""
    Write-Host "== $Name =="
    $ok = $false
    try {
        & $Body
        if ($LASTEXITCODE -ne 0) { throw "command exited $LASTEXITCODE" }
        $ok = $true
    } catch {
        Write-Host "Step failed: $_"
    }
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    $line = "[$mark] $Name"
    $Results.Add($line)
    Write-Host $line
    if (-not $ok) { $script:Failures++ }
}

function Invoke-Cargo([string]$Name, [string]$CmdArgs) {
    Invoke-Check $Name {
        Push-Location (Join-Path $Repo "src-tauri")
        try {
            $parts = $CmdArgs -split ' '
            & cargo @parts
        } finally {
            Pop-Location
        }
    }
}

Invoke-Check "Frontend unit/component tests" { npm.cmd test }
Invoke-Check "Frontend production build" { npm.cmd run build }
Invoke-Check "Architecture one-way deps" { npm.cmd run check:arch }
Invoke-Check "Version consistency" { npm.cmd run check:version }
Invoke-Cargo "Rust tests" "test"
Invoke-Cargo "Rust clippy (-D warnings)" "clippy --all-targets -- -D warnings"
Invoke-Cargo "Rust fmt check" "fmt --check"

# 关闭可能锁住 release exe / 干扰冒烟的运行中实例
Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

Invoke-Check "Release build (no bundle)" { npm.cmd run tauri -- build --no-bundle }
Invoke-Check "Log-driven smoke (10/10)" {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\smoke.ps1")
}

if (-not $SkipAgent) {
    Invoke-Check "Agent acceptance: --open-project deep link" {
        Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Milliseconds 500
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\agent-acceptance.ps1") -OpenProject -Verify
    }
    Invoke-Check "Agent acceptance: --open-homework deep link" {
        Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Milliseconds 500
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\agent-acceptance.ps1") -OpenHomework -Verify
    }
}

if ($Bench) {
    Invoke-Check "Benchmark smoke (DryRun)" {
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\benchmark.ps1") -DryRun -Rounds 1
    }
    Invoke-Check "Benchmark renderer sample" {
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\render-benchmarks.ps1") -Sample
    }
}

$Summary = "Release gate: $($Results.Count - $script:Failures)/$($Results.Count) passed"
$ReportPath = Join-Path $Repo "scripts\release-gate-report.log"
[System.IO.File]::WriteAllLines($ReportPath, $Results + $Summary)
Write-Host ""
Write-Host $Summary
Write-Host "Report: $ReportPath"
exit $script:Failures
