param(
    [string]$BaseImage = "resources\icons\rootup-sprout.png",
    [string]$OutDir = "resources\icons"
)

# Generates tray multi-size ICO (16/20/24/32/48/64, PNG frames), the red-dot
# badge variant and small menu icons. Build-time only (Windows System.Drawing);
# generated assets are committed and the runtime has zero extra dependencies.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Repo = Split-Path -Parent $PSScriptRoot
$BasePath = Join-Path $Repo $BaseImage
$OutPath = Join-Path $Repo $OutDir
$Sizes = 16, 20, 24, 32, 48, 64

if (-not (Test-Path $BasePath)) {
    throw "Base icon not found: $BasePath"
}

$Base = [System.Drawing.Image]::FromFile($BasePath)

function Write-TrayIco([string]$FilePath, [bool]$WithBadge) {
    $Frames = [System.Collections.Generic.List[object]]::new()
    foreach ($Size in $Sizes) {
        $Bmp = New-Object System.Drawing.Bitmap $Size, $Size
        $G = [System.Drawing.Graphics]::FromImage($Bmp)
        $G.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $G.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $G.Clear([System.Drawing.Color]::Transparent)
        $G.DrawImage($Base, 0, 0, $Size, $Size)
        if ($WithBadge) {
            $Radius = [Math]::Max(2, [int]($Size * 0.18))
            $Margin = [Math]::Max(1, [int]($Size * 0.1))
            $X = $Size - $Radius * 2 - $Margin
            $Y = $Size - $Radius * 2 - $Margin
            $White = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
            $Red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 220, 38, 38))
            $G.FillEllipse($White, $X - 1, $Y - 1, ($Radius + 1) * 2, ($Radius + 1) * 2)
            $G.FillEllipse($Red, $X, $Y, $Radius * 2, $Radius * 2)
            $White.Dispose()
            $Red.Dispose()
        }
        $Stream = New-Object System.IO.MemoryStream
        $Bmp.Save($Stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $Frames.Add([pscustomobject]@{ Size = $Size; Data = $Stream.ToArray() })
        $Stream.Dispose()
        $G.Dispose()
        $Bmp.Dispose()
    }

    $Out = New-Object System.IO.MemoryStream
    $Writer = New-Object System.IO.BinaryWriter($Out)
    $Writer.Write([UInt16]0)          # reserved
    $Writer.Write([UInt16]1)          # type: icon
    $Writer.Write([UInt16]$Frames.Count)
    $Offset = 6 + 16 * $Frames.Count
    foreach ($Frame in $Frames) {
        $Byte = if ($Frame.Size -ge 256) { 0 } else { $Frame.Size }
        $Writer.Write([byte]$Byte)     # width
        $Writer.Write([byte]$Byte)     # height
        $Writer.Write([byte]0)         # palette
        $Writer.Write([byte]0)         # reserved
        $Writer.Write([UInt16]1)       # planes
        $Writer.Write([UInt16]32)      # bpp
        $Writer.Write([UInt32]$Frame.Data.Length)
        $Writer.Write([UInt32]$Offset)
        $Offset += $Frame.Data.Length
    }
    foreach ($Frame in $Frames) {
        $Writer.Write($Frame.Data)
    }
    $Writer.Flush()
    [System.IO.File]::WriteAllBytes($FilePath, $Out.ToArray())
    $Writer.Dispose()
    $Out.Dispose()
}

function Write-MenuIcon([string]$FilePath, [bool]$IsQuit) {
    $Bmp = New-Object System.Drawing.Bitmap 16, 16
    $G = [System.Drawing.Graphics]::FromImage($Bmp)
    $G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $G.Clear([System.Drawing.Color]::Transparent)
    if ($IsQuit) {
        # Power symbol: outer circle + top stem (brand green)
        $Brand = [System.Drawing.Color]::FromArgb(16, 185, 129)
        $Brush = [System.Drawing.SolidBrush]::new($Brand)
        $Pen = [System.Drawing.Pen]::new($Brush, 2)
        $Pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $Pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $G.DrawEllipse($Pen, 3, 3, 10, 10)
        $G.DrawLine($Pen, 8, 2, 8, 8)
        $Pen.Dispose()
        $Brush.Dispose()
    } else {
        $G.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $G.DrawImage($Base, 0, 0, 16, 16)
    }
    $Bmp.Save($FilePath, [System.Drawing.Imaging.ImageFormat]::Png)
    $G.Dispose()
    $Bmp.Dispose()
}

try {
    New-Item -ItemType Directory -Force -Path $OutPath | Out-Null
    $Plain = Join-Path $OutPath "rootup-tray.ico"
    $Badge = Join-Path $OutPath "rootup-tray-badge.ico"
    $MenuOpen = Join-Path $OutPath "rootup-menu-open.png"
    $MenuQuit = Join-Path $OutPath "rootup-menu-quit.png"
    Write-TrayIco $Plain $false
    Write-TrayIco $Badge $true
    Write-MenuIcon $MenuOpen $false
    Write-MenuIcon $MenuQuit $true
    Write-Host "Generated:"
    Write-Host "  $Plain"
    Write-Host "  $Badge"
    Write-Host "  $MenuOpen"
    Write-Host "  $MenuQuit"
} finally {
    $Base.Dispose()
}
