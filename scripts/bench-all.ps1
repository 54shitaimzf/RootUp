param(
    [string]$Version = "",
    [int]$Rounds = 5,
    [switch]$Full,
    [switch]$Huge,
    [switch]$Small,
    [switch]$EngineOnly,
    [switch]$SystemOnly,
    [switch]$NoClean
)

# Local benchmark suite: engine -> system -> render -> cleanup.
# Same-machine comparisons only; host fingerprint is recorded in results.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

if ($EngineOnly -and $SystemOnly) {
    throw "Use either -EngineOnly or -SystemOnly, not both"
}

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
    $node = (& node --version 2>$null | Select-Object -First 1)
    $npmv = (& npm.cmd --version 2>$null | Select-Object -First 1)
    $ramGb = 0
    try { $ramGb = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1) } catch {}
    $commit = (& git -C $Repo rev-parse --short HEAD 2>$null)
    return [ordered]@{
        os = [Environment]::OSVersion.VersionString
        cpu = $env:PROCESSOR_IDENTIFIER
        rustc = $rustc
        node = $node
        npm = $npmv
        ram_gb = $ramGb
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

if (-not $SystemOnly) {
    Invoke-Step "Deterministic corpus self-check (200 files x2)" {
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\benchmark.ps1") -DeterminismCheck
    }

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
        $fp = Get-HostFingerprint
        if ($null -eq $engine.host) {
            $engine | Add-Member -NotePropertyName host -NotePropertyValue $fp -Force
        } else {
            $engine.host = $fp
        }
        if ($null -eq $engine.date) {
            $engine | Add-Member -NotePropertyName date -NotePropertyValue ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")) -Force
        }
        [System.IO.File]::WriteAllText(
            $enginePath,
            ($engine | ConvertTo-Json -Depth 10),
            (New-Object System.Text.UTF8Encoding $false)
        )
        $check = Get-Content $enginePath -Raw | ConvertFrom-Json
        $bad = @()
        if ($check.schema -ne 2) { $bad += "schema" }
        if (-not $check.date) { $bad += "date" }
        if (-not $check.host -or -not $check.host.commit) { $bad += "host.commit" }
        if (-not $check.host -or -not $check.host.node) { $bad += "host.node" }
        if (-not $check.host -or -not $check.host.npm) { $bad += "host.npm" }
        if ($null -eq $check.host -or $null -eq $check.host.ram_gb -or $check.host.ram_gb -le 0) { $bad += "host.ram_gb" }
        if ($bad.Count -gt 0) { throw "Engine result validation failed: $($bad -join ', ')" }
    }
}

if (-not $EngineOnly) {
    Invoke-Step "Rebuild release app (tauri build --no-bundle)" {
        npm.cmd run tauri -- build --no-bundle
    }
    Invoke-Step "System benchmark ($Rounds rounds)" {
        $args = @("-Version", $Version, "-Rounds", $Rounds)
        if ($Huge) { $args += "-Huge" } elseif ($Full) { $args += "-Full" }
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\benchmark.ps1") @args
    }
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
