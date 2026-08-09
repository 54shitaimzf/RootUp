param(
    [string]$Version = "0.8.6",
    [int]$Rounds = 7,
    [switch]$Full,
    [switch]$IncludePrevious,
    [switch]$SkipLoadCheck,
    [switch]$NoClean
)

# 0.8.6 release baseline one-shot:
#   1) optional v0.8.5 rerun on this machine (temp git worktree, full engine + system)
#   2) current version full baseline via bench-all.ps1
#   3) render + stale chart cleanup + leftover assertions
# No administrator rights are needed for this script.
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$ResultsDir = Join-Path $Repo "benchmarks\results"
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
$Prepared = Join-Path $env:TEMP ("rootup_bench_prepared_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Prepared | Out-Null

$script:Results = [System.Collections.Generic.List[string]]::new()
$script:Failures = 0

function Write-Step([string]$Name, [bool]$Ok, [string]$Detail = "") {
    $mark = if ($Ok) { "PASS" } else { "FAIL" }
    $line = "[$mark] $Name"
    if ($Detail) { $line += " | $Detail" }
    $script:Results.Add($line)
    Write-Host $line
    if (-not $Ok) { $script:Failures++ }
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

function Attach-Fingerprint([string]$EnginePath) {
    if (-not (Test-Path $EnginePath)) { throw "Engine result not found: $EnginePath" }
    $engine = Get-Content $EnginePath -Raw | ConvertFrom-Json
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
        $EnginePath,
        ($engine | ConvertTo-Json -Depth 10),
        (New-Object System.Text.UTF8Encoding $false)
    )
    $check = Get-Content $EnginePath -Raw | ConvertFrom-Json
    if (-not $check.host -or -not $check.host.commit) { throw "Engine fingerprint missing after attach" }
}

function Invoke-PrepareEngineCorpus {
    Write-Host "[prepare] engine corpus (10k + 100k, once)..."
    Push-Location (Join-Path $Repo "src-tauri")
    try {
        $env:ROOTUP_BENCH_PREPARE_ONLY = $Prepared
        $env:ROOTUP_BENCH_FULL = "1"
        cargo bench --features bench
        if ($LASTEXITCODE -ne 0) { throw "engine corpus prepare failed" }
    } finally {
        Pop-Location
        Remove-Item Env:ROOTUP_BENCH_PREPARE_ONLY, Env:ROOTUP_BENCH_FULL -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path (Join-Path $Prepared "scan10k")) -or -not (Test-Path (Join-Path $Prepared "scan100k"))) {
        throw "engine corpus prepare did not produce scan10k/scan100k"
    }
    Write-Host "[prepare] engine corpus ready under $Prepared"
}

function Invoke-PrepareSystemFixture {
    $fixture = Join-Path $Prepared "system10k"
    Write-Host "[prepare] system fixture (10k, once)..."
    $env:ROOTUP_BENCH_PREPARE_FIXTURE = $fixture
    try {
        powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\benchmark.ps1") -Rounds 1
        if ($LASTEXITCODE -ne 0) { throw "system fixture prepare failed" }
    } finally {
        Remove-Item Env:ROOTUP_BENCH_PREPARE_FIXTURE -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $fixture)) { throw "system fixture not created: $fixture" }
    Write-Host "[prepare] system fixture ready under $fixture"
}

function Test-QuietEnvironment {
    param(
        [int]$Samples = 3,
        [int]$CpuThreshold = 30,
        [int]$DiskThreshold = 30
    )
    $cpuValues = @()
    $diskValues = @()
    for ($i = 0; $i -lt $Samples; $i++) {
        $cpu = $null
        $disk = $null
        try {
            $cpu = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 2 -MaxSamples 1 -ErrorAction Stop).CounterSamples[0].CookedValue
        } catch {}
        try {
            $disk = (Get-Counter '\PhysicalDisk(_Total)\% Disk Time' -SampleInterval 0 -MaxSamples 1 -ErrorAction Stop).CounterSamples[0].CookedValue
        } catch {}
        if ($null -ne $cpu) { $cpuValues += $cpu }
        if ($null -ne $disk) { $diskValues += $disk }
        Start-Sleep -Milliseconds 400
    }
    $cpuAvg = if ($cpuValues.Count -gt 0) { ($cpuValues | Measure-Object -Average).Average } else { 0 }
    $diskAvg = if ($diskValues.Count -gt 0) { ($diskValues | Measure-Object -Average).Average } else { 0 }
    return [pscustomobject]@{
        Quiet = ($cpuAvg -le $CpuThreshold -and $diskAvg -le $DiskThreshold)
        Cpu = [Math]::Round($cpuAvg, 1)
        Disk = [Math]::Round($diskAvg, 1)
    }
}

function Invoke-PreviousRerun {
    # Returns $true on success. Failure is non-blocking: caller records it and
    # falls back to the archived 23H2 0.8.5 numbers (labelled not comparable).
    $tag = "v0.8.5"
    $work = Join-Path $env:TEMP ("rootup_bench_085_" + [guid]::NewGuid().ToString("N"))
    try {
        & git -C $Repo worktree add --detach $work $tag
        if ($LASTEXITCODE -ne 0) { throw "git worktree add failed" }

        if (-not (Test-Path (Join-Path $work "node_modules"))) {
            Write-Host "[0.8.5-rerun] copying node_modules from current workspace..."
            Copy-Item -Path (Join-Path $Repo "node_modules") -Destination (Join-Path $work "node_modules") -Recurse -Force
        }

        Push-Location $work
        try {
            Write-Host "[0.8.5-rerun] building v0.8.5 release app..."
            npm.cmd run tauri -- build --no-bundle
            if ($LASTEXITCODE -ne 0) { throw "v0.8.5 build failed" }

            Write-Host "[0.8.5-rerun] engine benchmark (full)..."
            $env:ROOTUP_BENCH_VERSION = "0.8.5-rerun"
            $env:ROOTUP_BENCH_SAMPLES = "5"
            $env:ROOTUP_BENCH_FULL = "1"
            $env:ROOTUP_BENCH_OUT = Join-Path $ResultsDir "0.8.5-rerun.engine.json"
            Push-Location (Join-Path $work "src-tauri")
            try {
                cargo bench --features bench
                if ($LASTEXITCODE -ne 0) { throw "v0.8.5 engine bench failed" }
            } finally {
                Pop-Location
            }
            Remove-Item Env:ROOTUP_BENCH_OUT -ErrorAction SilentlyContinue
            Remove-Item Env:ROOTUP_BENCH_FULL -ErrorAction SilentlyContinue
            Attach-Fingerprint (Join-Path $ResultsDir "0.8.5-rerun.engine.json")

            Write-Host "[0.8.5-rerun] system benchmark ($Rounds rounds)..."
            $oldExe = Join-Path $work "src-tauri\target\release\rootup.exe"
            $env:ROOTUP_BENCH_FIXTURE = Join-Path $Prepared "system10k"
            powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts\benchmark.ps1") `
                -ExePath $oldExe -Version "0.8.5-rerun" -Rounds $Rounds -ResultsDir $ResultsDir
            if ($LASTEXITCODE -ne 0) { throw "v0.8.5 system bench failed" }
        } finally {
            Pop-Location
        }
        return $true
    } catch {
        Write-Host "[0.8.5-rerun] FAILED: $_" -ForegroundColor Yellow
        return $false
    } finally {
        Remove-Item Env:ROOTUP_BENCH_VERSION, Env:ROOTUP_BENCH_SAMPLES, Env:ROOTUP_BENCH_OUT, Env:ROOTUP_BENCH_FULL -ErrorAction SilentlyContinue
        Remove-Item Env:ROOTUP_MFT_SCAN, Env:ROOTUP_ENUM, Env:ROOTUP_MFT_FORCE, Env:ROOTUP_BENCH_FIXTURE, Env:ROOTUP_BENCH_USE_CORPUS -ErrorAction SilentlyContinue
        & git -C $Repo worktree remove --force $work 2>$null | Out-Null
        if (Test-Path $work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Remove-StaleCharts {
    $readmePath = Join-Path $Repo "benchmarks\README.md"
    $chartsDir = Join-Path $Repo "benchmarks\charts"
    if (-not (Test-Path $readmePath) -or -not (Test-Path $chartsDir)) { return }
    $text = Get-Content $readmePath -Raw
    $refs = [regex]::Matches($text, 'charts/([A-Za-z0-9_\-\.]+\.svg)') | ForEach-Object { $_.Groups[1].Value }
    $refSet = @{}; foreach ($r in $refs) { $refSet[$r] = $true }
    $removed = 0
    foreach ($f in Get-ChildItem $chartsDir -Filter "*.svg") {
        if (-not $refSet.ContainsKey($f.Name)) {
            Remove-Item $f.FullName -Force
            $removed++
        }
    }
    Write-Host "[stale-charts] removed $removed unreferenced SVG files"
}

# ---- preflight ----
if (-not $SkipLoadCheck) {
    $envCheck = Test-QuietEnvironment
    if (-not $envCheck.Quiet) {
        Write-Host ("Load gate FAIL: environment busy (CPU={0}% / disk={1}%). Close background tasks and retry." -f $envCheck.Cpu, $envCheck.Disk)
        exit 1
    }
    Write-Host ("Load gate PASS: environment quiet (CPU={0}% / disk={1}%)" -f $envCheck.Cpu, $envCheck.Disk)
}

try {
    Invoke-PrepareEngineCorpus
    Invoke-PrepareSystemFixture

    if ($IncludePrevious) {
        $ok = Invoke-PreviousRerun
        if ($ok) {
            $rerunJson = Join-Path $ResultsDir "0.8.5-rerun.json"
            if (-not (Test-Path $rerunJson)) {
                Write-Host "[0.8.5-rerun] WARNING: rerun reported PASS but system JSON is missing" -ForegroundColor Yellow
                $ok = $false
            }
        }
        if ($ok) {
            Write-Step "0.8.5 rerun (25H2, engine + system)" $true
        } else {
            Write-Step "0.8.5 rerun (25H2, engine + system)" $false "fallback: archived 23H2 0.8.5 values labelled not comparable"
        }
    }

    # ---- current official baseline (reuses prepared corpora/fixture) ----
    $env:ROOTUP_BENCH_USE_CORPUS = $Prepared
    $env:ROOTUP_BENCH_FIXTURE = Join-Path $Prepared "system10k"
    $benchArgs = @("-Full", "-Version", $Version, "-Rounds", $Rounds)
    if ($SkipLoadCheck) { $benchArgs += "-SkipLoadCheck" }
    if ($NoClean) { $benchArgs += "-NoClean" }
    $launchArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        (Join-Path $Repo "scripts\bench-all.ps1")
    )
    $launchArgs += $benchArgs
    Write-Host "== Current official baseline (bench-all -Full -Version $Version -Rounds $Rounds) =="
    $proc = Start-Process -FilePath "powershell" -ArgumentList $launchArgs -Wait -PassThru -NoNewWindow
    Write-Step "Current official baseline (bench-all -Full -Version $Version -Rounds $Rounds)" ($proc.ExitCode -eq 0) ("exit={0}" -f $proc.ExitCode)

    Remove-StaleCharts

    # ---- post assertions ----
    $tmpFiles = @(Get-ChildItem -Path $Repo -Recurse -Force -File -Include *.json.tmp, *.tmp -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules|target|\.git\\' })
    Write-Step "No *.tmp / *.json.tmp leftovers" ($tmpFiles.Count -eq 0) ("found={0}" -f $tmpFiles.Count)

    $running = @(Get-Process -Name rootup -ErrorAction SilentlyContinue)
    Write-Step "No running rootup processes" ($running.Count -eq 0) ("count={0}" -f $running.Count)

    $leftover = @(Get-ChildItem $env:TEMP -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'rootup_bench_prepared_*' -or $_.Name -like 'rootup_mft_corpus_*' -or $_.Name -like 'rootup_bench_085_*' })
    Write-Step "No leftover benchmark corpora" ($leftover.Count -eq 0) ("count={0}" -f $leftover.Count)
} finally {
    Remove-Item Env:ROOTUP_BENCH_USE_CORPUS, Env:ROOTUP_BENCH_FIXTURE -ErrorAction SilentlyContinue
    Remove-Item $Prepared -Recurse -Force -ErrorAction SilentlyContinue
}

$summary = "bench-release: $($script:Results.Count - $script:Failures)/$($script:Results.Count) passed"
Write-Host ""
Write-Host $summary
Write-Host ""
Write-Host "Next step (run as Administrator, after this baseline completes):"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bench-scan-paths.ps1 -Sizes \"1000,10000,20000,30000,50000\" -Rounds 3"
exit $script:Failures
