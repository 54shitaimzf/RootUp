param(
    [string]$ExpectedVersion = ""
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Results = [System.Collections.Generic.List[string]]::new()
$Failures = 0

function Write-Result([string]$name, [bool]$ok, [string]$detail = "") {
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    $line = "[$mark] $name"
    if ($detail) { $line += " | $detail" }
    $Results.Add($line)
    Write-Host $line
    if (-not $ok) { $script:Failures++ }
}

function Read-Utf8([string]$relPath) {
    return [System.IO.File]::ReadAllText((Join-Path $Repo $relPath), [System.Text.Encoding]::UTF8)
}

$SemVer = '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
$sources = [System.Collections.Generic.List[object]]::new()

$pkgRaw = Read-Utf8 "package.json"
if ($pkgRaw -match '"version"\s*:\s*"([^"]+)"') {
    $sources.Add([pscustomobject]@{ Label = "package.json"; Value = $Matches[1].Trim() })
} else {
    Write-Result "package.json version field readable" $false
    exit 1
}

$lockRaw = Read-Utf8 "package-lock.json"
$lockMatches = [regex]::Matches($lockRaw, '"version"\s*:\s*"([^"]+)"')
if ($lockMatches.Count -ge 2) {
    $sources.Add([pscustomobject]@{ Label = "package-lock.json (root)"; Value = $lockMatches[0].Groups[1].Value.Trim() })
    $sources.Add([pscustomobject]@{ Label = 'package-lock.json (packages[""])'; Value = $lockMatches[1].Groups[1].Value.Trim() })
} else {
    Write-Result "package-lock.json version field readable" $false
    exit 1
}

$cargo = Read-Utf8 "src-tauri\Cargo.toml"
if ($cargo -match '(?m)^version\s*=\s*"([^"]+)"') {
    $sources.Add([pscustomobject]@{ Label = "src-tauri/Cargo.toml"; Value = $Matches[1].Trim() })
} else {
    Write-Result "Cargo.toml version field readable" $false
    exit 1
}

$tauriRaw = Read-Utf8 "src-tauri\tauri.conf.json"
if ($tauriRaw -match '"version"\s*:\s*"([^"]+)"') {
    $sources.Add([pscustomobject]@{ Label = "src-tauri/tauri.conf.json"; Value = $Matches[1].Trim() })
} else {
    Write-Result "tauri.conf.json version field readable" $false
    exit 1
}

$const = Read-Utf8 "src\lib\constants.ts"
if ($const -match 'APP_VERSION\s*=\s*"([^"]+)"') {
    $sources.Add([pscustomobject]@{ Label = "src/lib/constants.ts"; Value = $Matches[1].Trim() })
} else {
    Write-Result "constants.ts version field readable" $false
    exit 1
}

foreach ($s in $sources) {
    if ($s.Value -notmatch $SemVer) {
        Write-Result "SemVer format ($($s.Label))" $false $s.Value
    } else {
        Write-Result "SemVer format ($($s.Label))" $true $s.Value
    }
}

$unique = @($sources | Select-Object -ExpandProperty Value -Unique)
if ($unique.Count -eq 1) {
    Write-Result "All version sources match" $true $unique[0]
} else {
    $detail = $unique -join " / "
    Write-Result "All version sources match" $false $detail
    $sources | ForEach-Object { Write-Result "  $($_.Label)" $false $_.Value }
}

$appVersion = $unique[0]
if ($ExpectedVersion -and $appVersion -ne $ExpectedVersion) {
    Write-Result "Version matches expected tag ($ExpectedVersion)" $false "app=$appVersion"
} elseif ($ExpectedVersion) {
    Write-Result "Version matches expected tag ($ExpectedVersion)" $true
}

$changelog = Read-Utf8 "CHANGELOG.md"
if ($appVersion -like "*-dev") {
    if ($changelog -match '(?m)^## \[Unreleased\]') {
        Write-Result "CHANGELOG has [Unreleased] section" $true
    } else {
        Write-Result "CHANGELOG has [Unreleased] section" $false "dev version $appVersion requires it"
    }
} else {
    $escaped = [regex]::Escape($appVersion)
    if ($changelog -match "(?m)^## \[$escaped\]") {
        Write-Result "CHANGELOG has [$appVersion] section" $true
    } else {
        Write-Result "CHANGELOG has [$appVersion] section" $false
    }
}

Write-Host ""
if ($Failures -eq 0) { Write-Host "Version check PASS" } else { Write-Host "Version check FAIL" }
exit $Failures
