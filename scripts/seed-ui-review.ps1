# 0.8.4 UI review boundary data seed/restore helper.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\seed-ui-review.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\seed-ui-review.ps1 -Launch
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\seed-ui-review.ps1 -Force -Launch
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\seed-ui-review.ps1 -Restore
#
# Flow: stop app -> backup original data (first time only) -> replace app data files ->
# rebuild boundary fixture directory -> optionally launch release build.
# -Restore stops the app, restores the original data, and removes fixtures/backup.
param(
    [switch]$Launch,
    [switch]$Restore,
    [switch]$Force
)
$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent $PSScriptRoot
$AppData = Join-Path $env:APPDATA "com.rootup.desktop"
$LocalRootUp = Join-Path $env:LOCALAPPDATA "RootUp"
$FixtureRoot = Join-Path $LocalRootUp "ui-review-fixtures"
$BackupDir = Join-Path $AppData "ui-review-backup"
$ManifestPath = Join-Path $BackupDir "restore-manifest.json"
$SeedDataPath = Join-Path $Repo "fixtures\ui-review-seed.json"
$ReleaseExe = Join-Path $Repo "src-tauri\target\release\rootup.exe"
$ManagedFiles = @(
    "settings.json",
    "study.json",
    "labels.json",
    "schemes.json",
    "habits.json",
    "rootup.db",
    "rootup.db-wal",
    "rootup.db-shm"
)

function Stop-RootUp {
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 800
}

function Write-Utf8Json {
    param([string]$Path, $Value, [int]$Depth)
    $json = $Value | ConvertTo-Json -Depth $Depth
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8)
}

function Remove-ManagedFiles {
    foreach ($name in $ManagedFiles) {
        $p = Join-Path $AppData $name
        if (Test-Path -LiteralPath $p) {
            Remove-Item -LiteralPath $p -Force
        }
    }
}

function Assert-PathInside {
    param([string]$Path, [string]$Root, [string]$LeafName)
    $full = [System.IO.Path]::GetFullPath($Path)
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
    if (-not $full.StartsWith($rootFull + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to touch path outside expected root: $full"
    }
    if ([System.IO.Path]::GetFileName($full) -ne $LeafName) {
        throw "Refusing to touch unexpected leaf: $full (expected $LeafName)"
    }
    return $full
}

function Backup-AppData {
    if (Test-Path -LiteralPath $ManifestPath) {
        return
    }
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    $backed = @()
    foreach ($name in $ManagedFiles) {
        $src = Join-Path $AppData $name
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $BackupDir $name) -Force
            $backed += $name
        }
    }
    $manifest = @{
        backupAt = (Get-Date).ToString("o")
        files    = $backed
    } | ConvertTo-Json -Depth 5
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ManifestPath, $manifest, $utf8)
    Write-Host "[BACKUP] Original data backed up: $($backed.Count) file(s)"
}

function Restore-AppData {
    if (-not (Test-Path -LiteralPath $ManifestPath)) {
        throw "No UI review backup found at $BackupDir"
    }
    $manifest = Get-Content -Raw -Encoding UTF8 $ManifestPath | ConvertFrom-Json
    Remove-ManagedFiles
    foreach ($name in $manifest.files) {
        $bak = Join-Path $BackupDir $name
        if (Test-Path -LiteralPath $bak) {
            Copy-Item -LiteralPath $bak -Destination (Join-Path $AppData $name) -Force
        }
    }
    Write-Host "[RESTORE] Restored $($manifest.files.Count) file(s)"
}

function Write-SeedFiles {
    param($Data)
    $settings = @{
        version              = 3
        theme                = $Data.settings.theme
        language             = $Data.settings.language
        watched_dirs         = @($FixtureRoot.Replace("\", "/"))
        ignore_rules         = $Data.settings.ignore_rules
        classify_overrides   = $Data.settings.classify_overrides
        project_dirs         = $Data.settings.project_dirs
        preferred_ide        = $Data.settings.preferred_ide
        custom_open_commands = $Data.settings.custom_open_commands
        archive_root         = $Data.settings.archive_root
        auto_archive         = $Data.settings.auto_archive
        close_action         = $Data.settings.close_action
        reminder_enabled     = $Data.settings.reminder_enabled
        reminder_lead_days   = $Data.settings.reminder_lead_days
    }
    Write-Utf8Json (Join-Path $AppData "settings.json") @{ settings = $settings } 13
    Write-Utf8Json (Join-Path $AppData "study.json") $Data.study 40

    $labels = @($Data.labels)
    $labelPrefix = [string][char]0x6807 + [char]0x7B7E
    for ($i = 1; $i -le 90; $i++) {
        $labels += @{
            key   = ("label-{0:D2}" -f $i)
            name  = ("{0}-{1:D2}" -f $labelPrefix, $i)
            icon  = "tag"
            color = "slate"
        }
    }
    Write-Utf8Json (Join-Path $AppData "labels.json") $labels 6

    $schemes = @($Data.schemes)
    $schemePrefix = [string][char]0x65B9 + [char]0x6848
    for ($i = 1; $i -le 17; $i++) {
        $schemes += @{
            id                 = ("scheme-{0:D2}" -f $i)
            name               = ("{0}-{1:D2}" -f $schemePrefix, $i)
            ignore_rules       = @{ extensions = @("tmp"); prefixes = @(); exact_names = @() }
            classify_overrides = @()
        }
    }
    Write-Utf8Json (Join-Path $AppData "schemes.json") $schemes 10
    Write-Utf8Json (Join-Path $AppData "habits.json") @{} 3
}

function Reset-FixtureDir {
    if (Test-Path -LiteralPath $FixtureRoot) {
        $full = Assert-PathInside $FixtureRoot $LocalRootUp "ui-review-fixtures"
        Remove-Item -LiteralPath $full -Recurse -Force
    }
    New-Item -ItemType Directory -Path $FixtureRoot -Force | Out-Null
}

function New-FixtureFiles {
    param($Files)
    $index = 0
    foreach ($f in $Files) {
        $index++
        $name = $f.name
        if ($f.longNameChars) {
            $name = ("L" * [int]$f.longNameChars) + "-" + $name
        }
        $rel = if ($f.subdir) { Join-Path $f.subdir $name } else { $name }
        $full = Join-Path $FixtureRoot $rel
        $dir = Split-Path -Parent $full
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null

        $size = 1024 + (137 * (($index - 1) % 128))
        if ($f.PSObject.Properties["sizeBytes"]) {
            $size = [long]$f.sizeBytes
        }
        if ($size -le 65536) {
            [System.IO.File]::WriteAllBytes($full, [byte[]]::new([int]$size))
        } else {
            $stream = [System.IO.File]::Open(
                $full,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write
            )
            try {
                $stream.SetLength($size)
            } finally {
                $stream.Dispose()
            }
        }

        $modified = [DateTime]::UtcNow
        if ($f.PSObject.Properties["modifiedDays"]) {
            $modified = [DateTime]::UtcNow.AddDays([double]$f.modifiedDays)
        }
        if ($f.PSObject.Properties["modified"]) {
            $modified = [DateTime]::ParseExact(
                [string]$f.modified,
                "yyyy-MM-ddTHH:mm:ss",
                [System.Globalization.CultureInfo]::InvariantCulture
            )
        }
        [System.IO.File]::SetLastWriteTimeUtc($full, $modified)

        if ($f.hidden -eq $true) {
            [System.IO.File]::SetAttributes($full, [System.IO.FileAttributes]::Hidden)
        }
        if ($f.hiddenDir -eq $true) {
            $attrs = [System.IO.File]::GetAttributes($dir)
            [System.IO.File]::SetAttributes(
                $dir,
                $attrs -bor [System.IO.FileAttributes]::Hidden
            )
        }
    }
}

function Assert-Count {
    param([string]$Label, [int]$Actual, [int]$Expected)
    if ($Actual -ne $Expected) {
        Write-Host "[WARN] $Label expected=$Expected actual=$Actual"
    } else {
        Write-Host "[PASS] $Label = $Actual"
    }
}

if ($Restore -and $Launch) {
    throw "-Restore and -Launch are mutually exclusive"
}

Stop-RootUp

if ($Restore) {
    Restore-AppData
    if (Test-Path -LiteralPath $FixtureRoot) {
        $fixtureFull = Assert-PathInside $FixtureRoot $LocalRootUp "ui-review-fixtures"
        Remove-Item -LiteralPath $fixtureFull -Recurse -Force
    }
    if (Test-Path -LiteralPath $BackupDir) {
        $backupFull = Assert-PathInside $BackupDir $AppData "ui-review-backup"
        Remove-Item -LiteralPath $backupFull -Recurse -Force
    }
    Write-Host "[PASS] Restore complete; fixtures and backup removed"
    exit 0
}

if (-not (Test-Path -LiteralPath $SeedDataPath)) {
    throw "Missing seed dataset: $SeedDataPath"
}
if (-not $Force -and (Test-Path -LiteralPath $ManifestPath)) {
    throw "Already seeded (backup exists). Use -Force to re-seed or -Restore to restore."
}

$Data = Get-Content -Raw -Encoding UTF8 $SeedDataPath | ConvertFrom-Json

if (Test-Path -LiteralPath $ManifestPath) {
    Write-Host "[INFO] Backup already exists; keeping original data"
} else {
    Backup-AppData
}

Remove-ManagedFiles
Write-SeedFiles $Data
Reset-FixtureDir
New-FixtureFiles $Data.files

$actualFiles = @(Get-ChildItem -LiteralPath $FixtureRoot -Recurse -Force -File)
$labelsRaw = Get-Content -Raw -Encoding UTF8 (Join-Path $AppData "labels.json")
$schemesRaw = Get-Content -Raw -Encoding UTF8 (Join-Path $AppData "schemes.json")
$studyRaw = Get-Content -Raw -Encoding UTF8 (Join-Path $AppData "study.json")
$labelsParsed = $labelsRaw | ConvertFrom-Json
$schemesParsed = $schemesRaw | ConvertFrom-Json
$labelCount = @($labelsParsed).Count
$schemeCount = @($schemesParsed).Count
$study = $studyRaw | ConvertFrom-Json
$settingsParsed = Get-Content -Raw -Encoding UTF8 (Join-Path $AppData "settings.json") | ConvertFrom-Json
$settingsOk = ($null -ne $settingsParsed.settings) -and
    ($settingsParsed.settings.watched_dirs -contains $FixtureRoot.Replace("\", "/"))
if ($settingsOk) {
    Write-Host "[PASS] settings store shape + watched dir"
} else {
    Write-Host "[WARN] settings store shape or watched dir mismatch"
}

Assert-Count "fixture files" $actualFiles.Count $Data.expected.fileCount
Assert-Count "labels" $labelCount $Data.expected.labelCount
Assert-Count "schemes" $schemeCount $Data.expected.schemeCount
Assert-Count "semesters" @($study.semesters).Count $Data.expected.semesterCount
$homeworkCount = 0
foreach ($key in $study.homeworkBySemester.PSObject.Properties.Name) {
    $homeworkCount += @($study.homeworkBySemester.$key).Count
}
Assert-Count "homework" $homeworkCount $Data.expected.homeworkCount

Write-Host "[SEED] UI review data ready; watched dir = $FixtureRoot"

if ($Launch) {
    if (-not (Test-Path -LiteralPath $ReleaseExe)) {
        throw "Release build not found: $ReleaseExe"
    }
    Start-Process -FilePath $ReleaseExe
    Write-Host "[LAUNCH] RootUp started: $ReleaseExe"
}

exit 0
