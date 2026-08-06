param(
    [string]$BaseImage = "resources\icons\rootup-sprout.png",
    [string]$OutDir = "resources\icons"
)

# 生成托盘多尺寸 ICO（16/20/24/32/48/64，PNG 帧内嵌）与红点角标版。
# 仅构建期工具（Windows System.Drawing），产物提交仓库，运行时零依赖。
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Repo = Split-Path -Parent $PSScriptRoot
$BasePath = Join-Path $Repo $BaseImage
$OutPath = Join-Path $Repo $OutDir
$Sizes = 16, 20, 24, 32, 48, 64

if (-not (Test-Path $BasePath)) {
    throw "未找到基础图标: $BasePath"
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

try {
    New-Item -ItemType Directory -Force -Path $OutPath | Out-Null
    $Plain = Join-Path $OutPath "rootup-tray.ico"
    $Badge = Join-Path $OutPath "rootup-tray-badge.ico"
    Write-TrayIco $Plain $false
    Write-TrayIco $Badge $true
    Write-Host "已生成:"
    Write-Host "  $Plain"
    Write-Host "  $Badge"
} finally {
    $Base.Dispose()
}
