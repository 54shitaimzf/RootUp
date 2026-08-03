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

Write-Host "Architecture check passed ($Checked relative imports, all one-way)."
exit 0
