param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $Repo "resources\icons\projects" }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Add-Type -AssemblyName System.Drawing

function New-BadgePng([string]$text, [string]$hex, [string]$pngPath) {
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $r = [Convert]::ToByte($hex.Substring(1, 2), 16)
    $g2 = [Convert]::ToByte($hex.Substring(3, 2), 16)
    $b = [Convert]::ToByte($hex.Substring(5, 2), 16)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $r, $g2, $b))

    $radius = 48
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)

    $font = New-Object System.Drawing.Font("Segoe UI", 110, [System.Drawing.FontStyle]::Bold)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.DrawString($text, $font, $textBrush, (New-Object System.Drawing.RectangleF(0, 4, $size, $size)), $format)

    $g.Dispose()
    $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

function ConvertTo-Ico([string]$pngPath, [string]$icoPath) {
    $pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([uint16]0)       # reserved
    $bw.Write([uint16]1)       # type: icon
    $bw.Write([uint16]1)       # count
    $bw.Write([byte]0)         # width 256 -> 0
    $bw.Write([byte]0)         # height 256 -> 0
    $bw.Write([byte]0)         # palette
    $bw.Write([byte]0)         # reserved
    $bw.Write([uint16]1)       # planes
    $bw.Write([uint16]32)      # bit count
    $bw.Write([uint32]$pngBytes.Length)
    $bw.Write([uint32]22)      # data offset
    $bw.Write($pngBytes)
    [System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
}

$badges = @(
    @{ Name = "rust";    Text = "R";   Color = "#CE422B" },
    @{ Name = "node";    Text = "N";   Color = "#339933" },
    @{ Name = "python";  Text = "Py";  Color = "#3776AB" },
    @{ Name = "java";    Text = "J";   Color = "#F89820" },
    @{ Name = "csharp";  Text = "C#";  Color = "#68217A" },
    @{ Name = "go";      Text = "Go";  Color = "#00ADD8" },
    @{ Name = "unity";   Text = "U";   Color = "#222C37" },
    @{ Name = "obsidian";Text = "O";   Color = "#7C3AED" },
    @{ Name = "matlab";  Text = "M";   Color = "#0076A8" },
    @{ Name = "generic"; Text = "F";   Color = "#64748B" }
)

foreach ($badge in $badges) {
    $png = Join-Path $OutDir ($badge.Name + ".png")
    $ico = Join-Path $OutDir ($badge.Name + ".ico")
    New-BadgePng $badge.Text $badge.Color $png
    ConvertTo-Ico $png $ico
    Remove-Item $png -Force
}

Write-Host "Generated $($badges.Count) icons in $OutDir"
