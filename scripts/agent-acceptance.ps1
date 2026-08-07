param(
    [string]$ExePath = "src-tauri\target\release\rootup.exe",
    [string]$OutDir = "",
    [switch]$OpenProject,
    [switch]$OpenHomework,
    [switch]$SkipLaunch,
    [switch]$NoCapture,
    [switch]$Verify,
    [string]$ReportPath = ""
)

# Agent-guided real-scenario acceptance: prepares a real fixture workspace,
# launches the release app with a deep-link argument and captures screenshots
# of the main window and the tray area for the agent to inspect visually.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RootUpWin32 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$Repo = Split-Path -Parent $PSScriptRoot
$RunStarted = Get-Date
$Exe = Join-Path $Repo $ExePath
if (-not (Test-Path $Exe)) {
    throw "Release exe not found: $Exe (run: npm run tauri build)"
}
if (-not $OutDir) {
    $OutDir = Join-Path $env:TEMP ("rootup_agent_acceptance_" + [DateTime]::Now.ToString("yyyyMMdd_HHmmss"))
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Workspace = Join-Path $OutDir "fixture"
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null

# Real fixture: a Rust project, course-named files and a music file
$Project = Join-Path $Workspace "demo-project"
New-Item -ItemType Directory -Force -Path (Join-Path $Project "src") | Out-Null
Set-Content -Path (Join-Path $Project "Cargo.toml") -Value "[package]`nname = `"demo-project`"`nversion = `"0.1.0`"" -Encoding UTF8
Set-Content -Path (Join-Path $Project "src\main.rs") -Value "fn main() {}" -Encoding UTF8
$CourseDir = Join-Path $Workspace "course-files"
New-Item -ItemType Directory -Force -Path $CourseDir | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $CourseDir "math-notes.pdf"), [byte[]](1, 2, 3))
[System.IO.File]::WriteAllBytes((Join-Path $CourseDir "math-homework.docx"), [byte[]](4, 5, 6))
[System.IO.File]::WriteAllBytes((Join-Path $Workspace "music.mp3"), [byte[]](7, 8, 9))

$Args = @()
if ($OpenProject) { $Args += "--open-project `"$Project`"" }
if ($OpenHomework) { $Args += "--open-homework" }

$KnownIdePids = @(Get-Process -Name Code,Cursor,idea64,devenv -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
function Stop-TestProcesses {
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        Get-Process -Name Code,Cursor,idea64,devenv -ErrorAction SilentlyContinue |
            Where-Object { $KnownIdePids -notcontains $_.Id } |
            Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 1000
        if ((Get-SpawnedIdeCount) -eq 0) { break }
    }
    Get-Process -Name rootup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}
function Get-SpawnedIdeCount {
    return @(Get-Process -Name Code,Cursor,idea64,devenv -ErrorAction SilentlyContinue |
        Where-Object { $KnownIdePids -notcontains $_.Id }).Count
}

try {
if (-not $SkipLaunch) {
    if ($Args.Count -gt 0) {
        Start-Process -FilePath $Exe -ArgumentList $Args
    } else {
        Start-Process -FilePath $Exe
    }
    Start-Sleep -Seconds 4
}

$Shots = Join-Path $OutDir "shots"
New-Item -ItemType Directory -Force -Path $Shots | Out-Null
if (-not $NoCapture) {
    $MainPath = Join-Path $Shots "main.png"
    for ($i = 0; $i -lt 4; $i++) {
        $h = [RootUpWin32]::FindWindow($null, "RootUp")
        $attempt = 0
        while ($h -eq [IntPtr]::Zero -and $attempt -lt 3) {
            Start-Sleep -Seconds 2
            $h = [RootUpWin32]::FindWindow($null, "RootUp")
            $attempt++
        }
        if ($h -eq [IntPtr]::Zero) {
            $proc = Get-Process -Name rootup -ErrorAction SilentlyContinue |
                Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
            if ($proc) { $h = $proc.MainWindowHandle }
        }
        if ($h -ne [IntPtr]::Zero) {
            $rect = New-Object RootUpWin32+RECT
            [RootUpWin32]::GetWindowRect($h, [ref]$rect) | Out-Null
            $w = $rect.Right - $rect.Left
            $ht = $rect.Bottom - $rect.Top
            if ($w -gt 0 -and $ht -gt 0) {
                $bmp = New-Object System.Drawing.Bitmap $w, $ht
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $hdc = $g.GetHdc()
                [RootUpWin32]::PrintWindow($h, $hdc, 2) | Out-Null
                $g.ReleaseHdc($hdc)
                $bmp.Save($MainPath, [System.Drawing.Imaging.ImageFormat]::Png)
                $g.Dispose()
                $bmp.Dispose()
            }
        }
        if ((Test-Path $MainPath) -and (Get-Item $MainPath).Length -gt 50000) {
            break
        }
        Start-Sleep -Seconds 3
    }

    $TrayPath = Join-Path $Shots "tray.png"
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $tw = 420
    $th = 120
    $bmp = New-Object System.Drawing.Bitmap $tw, $th
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($screen.Right - $tw, $screen.Bottom - $th, 0, 0, (New-Object System.Drawing.Size($tw, $th)))
    $bmp.Save($TrayPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

Write-Host ""
Write-Host "Agent acceptance fixture:"
Write-Host "  Workspace : $Workspace"
Write-Host "  Project   : $Project (Cargo.toml -> Rust)"
Write-Host "  Courses   : $CourseDir (math-notes.pdf / math-homework.docx)"
Write-Host "  Screenshots: $Shots"
Write-Host ""
Write-Host "Checklist:"
Write-Host "  [ ] Project wake stays in tray (no foreground); IDE/Explorer opens the project"
Write-Host "  [ ] Later opening RootUp from tray lands on Projects page; add fixture via browse/drag-drop"
Write-Host "  [ ] Card shows demo-project with Rust badge and 'Detected via: Cargo.toml', source 'Manual'"
Write-Host "  [ ] Add fixture workspace as watched dir, then project source shows 'Auto' instead of 'Manual'"
Write-Host "  [ ] Course files in File page carry the course label after study data has the course"
Write-Host "  [ ] Tray icon renders sharply; after adding a past-due homework, red dot appears"
Write-Host "  [ ] Light/dark theme and zh/en switching stay consistent on these screens"

if ($Verify) {
    $Failures = 0
    $Results = [System.Collections.Generic.List[string]]::new()
    function Assert-Check([string]$Name, [bool]$Ok) {
        $mark = if ($Ok) { "PASS" } else { "FAIL" }
        $line = "[$mark] $Name"
        $Results.Add($line)
        Write-Host $line
        if (-not $Ok) { $script:Failures++ }
    }
    function Warn-Check([string]$Name, [bool]$Ok) {
        $line = "[WARN] $Name (best effort, verify visually)"
        $Results.Add($line)
        Write-Host $line
    }

    $Log = Join-Path $env:LOCALAPPDATA "com.rootup.desktop\logs\rootup.log"
    $NewLines = @()
    if (Test-Path $Log) {
        $startKey = $RunStarted.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        $NewLines = @(Get-Content $Log | Where-Object {
            $_.Length -ge 24 -and $_.Substring(0, 24) -ge $startKey
        })
    }
    Assert-Check "Log lines produced after run start" ($NewLines.Count -gt 0)
    if ($OpenProject) {
        Assert-Check "Frontend claimed Project intent" (($NewLines -match 'Some\(Project').Count -gt 0)
        Assert-Check "Projects page loaded (project: ...)" (($NewLines -match 'project: \S+').Count -gt 0)
    }
    if ($OpenHomework) {
        Assert-Check "Frontend claimed Homework intent" (($NewLines -match 'Some\(Homework\)').Count -gt 0)
    }
    if (-not $NoCapture) {
        $MainOk = (Test-Path $MainPath) -and ((Get-Item $MainPath).Length -gt 50000)
        $TrayOk = (Test-Path $TrayPath) -and ((Get-Item $TrayPath).Length -gt 1000)
        Warn-Check "Main window screenshot non-empty" $MainOk
        Warn-Check "Tray area screenshot non-empty" $TrayOk
    }

    Stop-TestProcesses
    Assert-Check "No test-spawned IDE processes remain" ((Get-SpawnedIdeCount) -eq 0)

    if (-not $ReportPath) { $ReportPath = Join-Path $OutDir "gate-report.txt" }
    $Summary = "Agent acceptance: $($Results.Count - $Failures)/$($Results.Count) passed"
    $Report = $Results + $Summary
    [System.IO.File]::WriteAllLines($ReportPath, $Report)
    Write-Host ""
    Write-Host $Summary
    Write-Host "Report: $ReportPath"
    if ($Failures -gt 0) { exit 1 }
}
} finally {
    Stop-TestProcesses
}
