# Read-only database audit for release: copies rootup.db (with WAL/SHM) to a
# temp dir, runs scripts/db-audit.sql via sqlite3 CLI, and validates the JSON
# data files (settings/study/labels/schemes/habits). Writes a markdown report
# when -ReportPath is provided; exits nonzero on any hard failure.
param(
    [string]$AppData = "",
    [string]$Sqlite3 = "",
    [string]$ReportPath = ""
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

if (-not $AppData) {
    $AppData = Join-Path $env:APPDATA "com.rootup.desktop"
}
if (-not $Sqlite3) {
    $Sqlite3 = (Get-Command sqlite3 -ErrorAction SilentlyContinue).Source
}
if (-not $Sqlite3) {
    throw "sqlite3 CLI not found; pass -Sqlite3 <path>"
}

$Running = Get-Process -Name rootup -ErrorAction SilentlyContinue
if ($Running) {
    throw "RootUp is running; stop it before the DB audit"
}

$DbPath = Join-Path $AppData "rootup.db"
if (-not (Test-Path -LiteralPath $DbPath)) {
    throw "Database not found: $DbPath"
}

$Tmp = Join-Path $env:TEMP ("rootup_db_audit_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
    foreach ($suffix in @("", "-wal", "-shm")) {
        $src = Join-Path $AppData ("rootup.db" + $suffix)
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $Tmp ("audit.db" + $suffix)) -Force
        }
    }

    $SqlText = Get-Content -Raw -Encoding UTF8 (Join-Path $Repo "scripts\db-audit.sql")
    $marker = "SELECT 'tables=' || IFNULL(group_concat(name, ','), '') FROM sqlite_master WHERE type = 'table';"
    $idx = $SqlText.IndexOf($marker)
    if ($idx -lt 0) {
        throw "db-audit.sql marker not found"
    }
    $HeadSql = $SqlText.Substring(0, $idx + $marker.Length)
    $TailSql = $SqlText.Substring($idx + $marker.Length)

    $TableProbe = "SELECT name FROM sqlite_master WHERE type = 'table';" |
        & $Sqlite3 (Join-Path $Tmp "audit.db") 2>$null
    $hasFiles = @($TableProbe | ForEach-Object { $_.ToString().Trim() }) -contains "files"

    $RunSql = if ($hasFiles) { $HeadSql + $TailSql } else { $HeadSql }
    $Raw = $RunSql | & $Sqlite3 (Join-Path $Tmp "audit.db") 2>&1
    $Lines = @($Raw | ForEach-Object { $_.ToString() })

    $results = [System.Collections.Generic.List[string]]::new()
    $failures = 0
    function Add-Check([string]$Name, [bool]$Ok, [string]$Detail) {
        $script:results.Add(("[{0}] {1} | {2}" -f $(if ($Ok) { "PASS" } else { "FAIL" }), $Name, $Detail))
        if (-not $Ok) { $script:failures++ }
    }

    function Get-Section([string]$Name) {
        $inside = $false
        $out = [System.Collections.Generic.List[string]]::new()
        foreach ($line in $Lines) {
            if ($line -eq "[$Name]") {
                $inside = $true
                continue
            }
            if ($inside) {
                if ($line -match '^\[[a-z_]+\]$') {
                    break
                }
                $out.Add($line)
            }
        }
        return $out.ToArray()
    }

    $integrity = @(Get-Section "integrity_check")
    $fk = @(Get-Section "foreign_key_check")
    $userVer = @(Get-Section "user_version")
    $journal = @(Get-Section "journal_mode")
    $stats = @(Get-Section "stats")
    $indexes = @(Get-Section "indexes")
    $explainLabel = @(Get-Section "explain_label_query")
    $explainAnd = @(Get-Section "explain_and_query")

    Add-Check "integrity_check" (($integrity | Where-Object { $_.Trim() -eq "ok" }).Count -gt 0) "lines=$($integrity.Count)"
    Add-Check "foreign_key_check" ($fk.Count -eq 0) "violations=$($fk.Count)"

    $map = @{}
    $tables = @()
    foreach ($line in $stats) {
        if ($line -match '^([a-z_]+)=\d+$') {
            $map[$Matches[1]] = [int64]$Matches[2]
        } elseif ($line -like "tables=*") {
            $tables = @(($line.Substring(7) -split ',') | Where-Object { $_ -ne "" })
        }
    }
    $userVersion = ($userVer | Select-Object -First 1).Trim()
    $journalMode = ($journal | Select-Object -First 1).Trim()
    if ($tables -notcontains "files") {
        Add-Check "fresh DB (schema initializes on first launch)" $true "user_version=$userVersion journal=$journalMode tables=[$($tables -join ',')]"
    } else {
        Add-Check "user_version" ($userVersion -eq "4") "got=$userVersion expected=4"
        Add-Check "journal_mode" ($journalMode -eq "wal") "got=$journalMode expected=wal"
        Add-Check "no duplicate path_key" ($map["duplicate_path_keys"] -eq 0) "count=$($map['duplicate_path_keys'])"
        Add-Check "no malformed labels" ($map["malformed_labels"] -eq 0) "count=$($map['malformed_labels'])"
        Add-Check "no pending archive without source" ($map["archive_pending_without_source"] -eq 0) "count=$($map['archive_pending_without_source'])"
        $expectedIndexes = @(
            "idx_files_state",
            "idx_files_modified",
            "idx_files_type"
        )
        $indexNames = @($indexes | ForEach-Object { $_.Trim() })
        $missing = @($expectedIndexes | Where-Object { $indexNames -notcontains $_ })
        Add-Check "0.8.5 query indexes present" ($missing.Count -eq 0) "missing=$($missing -join ',')"
        Add-Check "label query plan captured" ($explainLabel.Count -gt 0) "lines=$($explainLabel.Count)"
        Add-Check "AND query plan captured" ($explainAnd.Count -gt 0) "lines=$($explainAnd.Count)"
    }

    # ---- JSON data files ----
    $jsonFiles = @("settings.json", "study.json", "labels.json", "schemes.json", "habits.json")
    foreach ($name in $jsonFiles) {
        $path = Join-Path $AppData $name
        if (-not (Test-Path -LiteralPath $path)) {
            Add-Check "json $name (absent)" $true "absent, app fallback applies"
            continue
        }
        try {
            $value = Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json
            Add-Check "json $name parses" $true "OK"
            if ($name -eq "settings.json") {
                Add-Check "settings store shape" ($null -ne $value.settings) "has settings key"
            } elseif ($name -eq "study.json") {
                Add-Check "study shape" (
                    $null -ne $value.semesters -and $null -ne $value.coursesBySemester -and $null -ne $value.homeworkBySemester
                ) "semesters/courses/homework present"
            } elseif ($name -eq "habits.json") {
                $bad = $false
                foreach ($prop in $value.PSObject.Properties) {
                    $h = $prop.Value
                    if ($null -eq $h.count -or ($null -eq $h.lastUsed -and $null -eq $h.last_used)) {
                        $bad = $true
                    }
                }
                Add-Check "habits shape (count + lastUsed/last_used)" (-not $bad) "entries=$($value.PSObject.Properties.Name.Count)"
            }
        } catch {
            Add-Check "json $name parses" $false $_.Exception.Message
        }
    }

    # ---- report ----
    $report = [System.Collections.Generic.List[string]]::new()
    $report.Add("# RootUp 数据库审计报告")
    $report.Add("")
    $report.Add("- 时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $report.Add("- 数据库：$DbPath（副本审计，只读）")
    $report.Add("- sqlite3：$Sqlite3")
    $report.Add("")
    $report.Add("## SQL 审计")
    $report.Add("")
    $report.Add('```')
    $Lines | ForEach-Object { $report.Add($_) }
    $report.Add('```')
    $report.Add("")
    $report.Add("## 结论")
    $report.Add("")
    $results | ForEach-Object { $report.Add("- $_") }
    $report.Add("")
    $report.Add(("审计结果：{0} 项，失败 {1} 项" -f $results.Count, $failures))
    if ($ReportPath) {
        $full = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $Repo $ReportPath }
        [System.IO.File]::WriteAllLines(
            $full,
            $report,
            (New-Object System.Text.UTF8Encoding $false)
        )
        Write-Host "报告: $full"
    }
    $results | ForEach-Object { Write-Host $_ }
    Write-Host ("DB audit: {0} checks, {1} failures" -f $results.Count, $failures)
    exit $failures
}
finally {
    if (Test-Path -LiteralPath $Tmp) {
        Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
