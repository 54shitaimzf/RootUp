param(
    [string]$SrcDir = ""
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
if (-not $SrcDir) { $SrcDir = Join-Path $Repo "src-tauri\src" }
if (-not (Test-Path $SrcDir)) {
    Write-Host "Rust source dir not found: $SrcDir" -ForegroundColor Red
    exit 1
}

function Get-Layer([string]$path) {
    $rel = $path.Substring($SrcDir.Length + 1).Replace("\", "/")
    if ($rel -like "core/*") { return "core" }
    if ($rel -like "infra/*") { return "infra" }
    if ($rel -like "commands/*") { return "commands" }
    return $null
}

# Strip comments and string/char literals, then remove mod tests { ... } blocks by brace
# matching, so test-only cross-layer references and literal braces are ignored.
function Get-ProductionCode([string]$content) {
    $content = [regex]::Replace($content, '(?m)//[^\r\n]*', '')
    $content = [regex]::Replace($content, '(?s)/\*.*?\*/', '')
    $content = [regex]::Replace($content, '(?s)"(?:\\.|[^"\\])*"', '""')
    $content = [regex]::Replace($content, "(?s)'(?:\\.|[^'\\])*'", "''")
    $pattern = '(?s)\bmod\s+tests\s*\{'
    $result = [System.Text.StringBuilder]::new()
    $pos = 0
    foreach ($m in [regex]::Matches($content, $pattern)) {
        [void]$result.Append($content.Substring($pos, $m.Index - $pos))
        $depth = 0
        $i = $m.Index + $m.Length - 1
        while ($i -lt $content.Length) {
            $c = $content[$i]
            if ($c -eq '{') {
                $depth++
            } elseif ($c -eq '}') {
                $depth--
                if ($depth -eq 0) { break }
            }
            $i++
        }
        $pos = $i + 1
    }
    [void]$result.Append($content.Substring($pos))
    return $result.ToString()
}

# Layer rules: core stays pure (no Tauri/upper layers); infra must not depend on commands/app;
# commands only depend on core/infra and never on the composition root app.rs.
$Rules = @{
    "core"     = @(
        "use tauri",
        "tauri::",
        "use crate::infra",
        "crate::infra",
        "use crate::commands",
        "crate::commands",
        "use crate::app",
        "crate::app"
    )
    "infra"    = @(
        "use crate::commands",
        "crate::commands",
        "use crate::app",
        "crate::app"
    )
    "commands" = @(
        "use crate::app",
        "crate::app"
    )
}

$Files = Get-ChildItem -Path $SrcDir -Recurse -File -Filter *.rs
$Violations = [System.Collections.Generic.List[string]]::new()
$Checked = 0

foreach ($File in $Files) {
    $Layer = Get-Layer $File.FullName
    if (-not $Layer) { continue }
    $Content = Get-Content -Path $File.FullName -Raw -Encoding UTF8
    $Code = Get-ProductionCode $Content
    foreach ($Pattern in $Rules[$Layer]) {
        if ($Code.Contains($Pattern)) {
            $Rel = $File.FullName.Substring($Repo.Length + 1)
            $Violations.Add("$Rel -> $Pattern")
        }
    }
    $Checked++
}

if ($Violations.Count -gt 0) {
    Write-Host "Rust architecture check FAILED:" -ForegroundColor Red
    foreach ($V in $Violations) { Write-Host "  $V" -ForegroundColor Red }
    Write-Host "Checked $Checked files, found $($Violations.Count) violations."
    exit 1
}

Write-Host "Rust architecture check passed ($Checked files, layer rules enforced)."
exit 0
