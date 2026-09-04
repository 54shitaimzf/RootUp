param(
    [string]$SrcDir = ""
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
if (-not $SrcDir) { $SrcDir = Join-Path $Repo "src" }
if (-not (Test-Path $SrcDir)) {
    Write-Host "Frontend source dir not found: $SrcDir" -ForegroundColor Red
    exit 1
}

function Get-Layer([string]$path) {
    $rel = $path.Substring($SrcDir.Length + 1).Replace("\", "/")
    if ($rel -like "pages/*") { return "pages" }
    if ($rel -like "features/*") { return "features" }
    if ($rel -like "components/*") { return "components" }
    if ($rel -like "hooks/*") { return "hooks" }
    if ($rel -like "lib/*") { return "lib" }
    return $null
}

# One-way dependency matrix: source -> target; same-layer imports allowed only for features/components/hooks/lib.
$Allowed = @{
    "pages:features"    = $true
    "pages:components"  = $true
    "pages:hooks"       = $true
    "pages:lib"         = $true
    "features:features" = $true
    "features:components" = $true
    "features:hooks"    = $true
    "features:lib"      = $true
    "components:components" = $true
    "components:lib"    = $true
    "hooks:hooks"       = $true
    "hooks:lib"         = $true
    "lib:lib"           = $true
}

$Files = Get-ChildItem -Path $SrcDir -Recurse -File -Include *.ts, *.tsx |
    Where-Object { $_.FullName -notmatch "\.test\." -and $_.FullName -notmatch "\\test\\" }

$Violations = [System.Collections.Generic.List[string]]::new()
$Checked = 0

foreach ($File in $Files) {
    $SourceLayer = Get-Layer $File.FullName
    if (-not $SourceLayer) { continue }
    $Content = Get-Content -Path $File.FullName -Raw -Encoding UTF8
    $Matches = [regex]::Matches($Content, 'from\s+["''](\.[^"'']+)["'']')
    foreach ($Match in $Matches) {
        $Spec = $Match.Groups[1].Value
        $Target = [System.IO.Path]::GetFullPath(
            (Join-Path (Split-Path -Parent $File.FullName) $Spec)
        )
        $TargetLayer = Get-Layer $Target
        if (-not $TargetLayer) { continue }
        $Checked++
        $Key = "$SourceLayer`:$TargetLayer"
        if (-not $Allowed.ContainsKey($Key)) {
            $Rel = $File.FullName.Substring($Repo.Length + 1)
            $Violations.Add("$Rel -> $Spec ($TargetLayer)")
        }
    }
}

if ($Violations.Count -gt 0) {
    Write-Host "Architecture check FAILED (reverse or cross-layer imports):" -ForegroundColor Red
    foreach ($V in $Violations) { Write-Host "  $V" -ForegroundColor Red }
    Write-Host "Checked $Checked relative imports, found $($Violations.Count) violations."
    exit 1
}

# --- Event-name drift guard -------------------------------------------------
# App-level event names (source of truth: fixtures/app-contracts.json) must be
# referenced via src/lib/events.ts constants; raw quoted literals outside the
# registry fail the check (test files excluded, assertions may use literals).
$EventsRegistry = "src/lib/events.ts"
$EventAlternation = "scan-progress|scan-finished|files-changed|settings-changed|close-requested|project-open|study-homework-open"
$EventRegex = "[`"']($EventAlternation)[`"']"
$EventViolations = [System.Collections.Generic.List[string]]::new()

foreach ($File in $Files) {
    $Rel = $File.FullName.Substring($Repo.Length + 1).Replace("\", "/")
    if ($Rel -eq $EventsRegistry) { continue }
    $Content = Get-Content -Path $File.FullName -Raw -Encoding UTF8
    foreach ($Match in [regex]::Matches($Content, $EventRegex)) {
        $EventViolations.Add("$Rel -> raw event literal '$($Match.Groups[1].Value)' (use lib/events.ts APP_EVENTS)")
    }
}

if ($EventViolations.Count -gt 0) {
    Write-Host "Architecture check FAILED (raw event-name literals):" -ForegroundColor Red
    foreach ($V in $EventViolations) { Write-Host "  $V" -ForegroundColor Red }
    Write-Host "Found $($EventViolations.Count) raw event literals outside $EventsRegistry."
    exit 1
}

# --- Icon consumption guard --------------------------------------------------
# All icon imports must go through src/theme/icons.ts (the v1.3 skin swap point);
# importing lucide-react directly anywhere else fails the check (tests included).
$IconsEntry = "src/theme/icons.ts"
$LucideRegex = "from\s+[`"']lucide-react[`"']"
$IconViolations = [System.Collections.Generic.List[string]]::new()
$AllTsFiles = Get-ChildItem -Path $SrcDir -Recurse -File -Include *.ts, *.tsx

foreach ($File in $AllTsFiles) {
    $Rel = $File.FullName.Substring($Repo.Length + 1).Replace("\", "/")
    if ($Rel -eq $IconsEntry) { continue }
    $Content = Get-Content -Path $File.FullName -Raw -Encoding UTF8
    if ($Content -match $LucideRegex) {
        $IconViolations.Add("$Rel -> direct lucide-react import (use theme/icons.ts)")
    }
}

if ($IconViolations.Count -gt 0) {
    Write-Host "Architecture check FAILED (direct lucide-react imports):" -ForegroundColor Red
    foreach ($V in $IconViolations) { Write-Host "  $V" -ForegroundColor Red }
    Write-Host "Found $($IconViolations.Count) direct imports outside $IconsEntry."
    exit 1
}

Write-Host "Architecture check passed ($Checked relative imports, all one-way; event names via registry; icons via theme/icons)."
exit 0
