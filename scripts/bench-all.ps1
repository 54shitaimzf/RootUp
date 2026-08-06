param(
    [string]$Version = "",
    [int]$Rounds = 5,
    [switch]$Full,
    [switch]$Huge,
    [switch]$Small,
    [switch]$NoClean
)

# Local benchmark suite: engine -> system -> render -> cleanup.
# Same-machine comparisons only; host fingerprint is recorded in results.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

if (-not $Version) {
    $pkg = Get-Content (Join-Path $Repo "package.json") -Raw | ConvertFrom-Json
    $Version = $pkg.version
}

$results = [System.Collections.Generic.List[string]]::new()
$failures = 0

function Invoke-Step([string]$Name, [scriptblock]$Body) {
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
    $results.Add("[$mark] $Name")
    Write-Host $results[$results.Count - 1]
    if (-not $ok) { $script:failures++ }
}

function Get-HostFingerprint {
    $rustc = (& rustc --version 2>$null | Select-Object -First 1)
    $commit = (& git -C $Repo rev-parse --short HEAD 2>$null)
    return [ordered]@{
        os = [Environment]::OSVersion.VersionString
        cpu = $env:PROCESSOR_IDENTIFIER
        rustc = $rustc
        commit = $commit
    }
}

$exe = Join-Path $Repo "src-tauri\target\release\rootup.exe"
if (-not (Test-Path $exe)) {
    Write-Host "Release exe not found; run: npm run tauri build -- --no-bundle"
    exit 1
}

$env:ROOTUP_BENCH_VERSION = $Version
$env:ROOTUP_BENCH_SAMPLES = "5"
$env:ROOTUP_BENCH_OUT = Join-Path $Repo ("benchmarks\results\" + $Version + ".engine.json")
if ($Huge) { $env:ROOTUP_BENCH_HUGE = "1" }
elseif ($Full) { $env:ROOTUP_BENCH_FULL = "1" }
elseif ($Small) { $env:ROOTUP_BENCH_SMALL = "1" }

Invoke-Step "Engine benchmark (cargo bench --features bench)" {
    Push-Location (Join-Path $Repo "src-tauri")
    try {
        cargo bench --features bench
    } finally {
        Pop-Location
    }
}

Invoke-Step "Attach host fingerprint to engine result" {
    $enginePath = Join-Path $Repo ("benchmarks\results\" + $Version + ".engine.json")
    if (-not (Test-Path $enginePath)) { throw "Engine result not found: $enginePath" }
    $engine = Get-Content $enginePath -Raw | ConvertFrom-Json
    if ($null -eq $engine.host) {
        $engine | Add-Member -NotePropertyName host -NotePropertyValue (Get-HostFingerprint) -Force
    } else {
        $engine.host = Get-HostFingerprint
    }
    [System.IO.File]::WriteAllText(
        $enginePath,
        ($engine | ConvertTo-Json -Depth 10),
        (New-Object System.Text.UTF8Encoding $false)
    )
}

Invoke-Step "System benchmark ($Rounds rounds)" {
    $args = @("-Version", $Version, "-Rounds", $Rounds)
    if ($Huge) { $args += "-Huge" } elseif ($Full) { $args += "-Full" }
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\benchmark.ps1") @args
}

Invoke-Step "Render benchmark report" {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\render-benchmarks.ps1")
}

if (-not $NoClean) {
    Invoke-Step "Cleanup benchmark artifacts" {
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\bench-cleanup.ps1")
    }
}

$summary = "Bench-all: $($results.Count - $failures)/$($results.Count) passed"
Write-Host ""
Write-Host $summary
exit $failures
