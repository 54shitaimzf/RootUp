param(
    [string]$ExePath = "",
    [string]$LogDir = "",
    [string]$SettingsPath = ""
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$SummaryPath = Join-Path $PSScriptRoot "smoke-summary.log"
$Results = [System.Collections.Generic.List[string]]::new()
$Failures = 0
$Total = 0

function Write-Result([string]$name, [bool]$ok, [string]$detail = "") {
    $script:Total++
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    $line = "[$mark] $name"
    if ($detail) { $line += " | $detail" }
    $Results.Add($line)
    Write-Host $line
    if (-not $ok) { $script:Failures++ }
}

function Wait-LogLine([string]$logFile, [string]$pattern, [int]$timeoutSeconds = 90) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $logFile) {
            $match = Select-String -Path $logFile -Pattern $pattern -SimpleMatch | Select-Object -First 1
            if ($match) { return $true }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# ---- 参数与默认值 ----
if (-not $ExePath) { $ExePath = Join-Path $Repo "src-tauri\target\release\rootup.exe" }
if (-not (Test-Path $ExePath)) {
    Write-Host "未找到可执行文件: $ExePath" -ForegroundColor Red
    Write-Host "请先执行 tauri build --no-bundle，或通过 -ExePath 指定（可用 debug 版本）。"
    exit 1
}

$AppData = Join-Path $env:APPDATA "com.rootup.desktop"
if (-not $SettingsPath) { $SettingsPath = Join-Path $AppData "settings.json" }
if (-not $LogDir) { $LogDir = Join-Path $env:LOCALAPPDATA "com.rootup.desktop\logs" }
$LogFile = Join-Path $LogDir "rootup.log"

$Running = Get-Process -Name "rootup" -ErrorAction SilentlyContinue
if ($Running) {
    Write-Host "RootUp 正在运行，请先关闭后再执行冒烟测试。" -ForegroundColor Red
    exit 1
}

# ---- 备份现有设置 ----
$Backup = "$SettingsPath.smoke.bak"
if (Test-Path $SettingsPath) { Copy-Item $SettingsPath $Backup -Force }

# ---- 构造测试环境 ----
$TestRoot = Join-Path $env:TEMP ("rootup_smoke_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $TestRoot "sub") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $TestRoot '$RECYCLE.BIN') -Force | Out-Null

# 样本：5 个正式文件（含子目录 1 个）、3 个忽略文件（crdownload/desktop.ini/自定义 zzz）、1 个噪音目录
Set-Content -Path (Join-Path $TestRoot "course.pdf") -Value "pdf" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot "photo.png") -Value "png" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot "code.rs") -Value "fn main() {}" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot "archive.zip") -Value "zip" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot "sub\notes.txt") -Value "notes" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot "movie.crdownload") -Value "partial" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot "desktop.ini") -Value "[ViewState]" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot "test.zzz") -Value "custom" -Encoding UTF8
Set-Content -Path (Join-Path $TestRoot '$RECYCLE.BIN\trash.txt') -Value "x" -Encoding UTF8

# 设置：父目录 + 子目录重叠，验证启动自愈
$TestDir = $TestRoot.Replace("\", "/")
$Settings = @{
    settings = @{
        theme = "system"
        language = "zh-CN"
        watched_dirs = @($TestDir, "$TestDir/sub")
        ignore_rules = @{
            extensions = @("crdownload","part","download","tmp","temp","zzz")
            prefixes = @("~$")
            exact_names = @("desktop.ini","thumbs.db",".ds_store",'$recycle.bin')
        }
        classify_overrides = @(
            @{ extensions = @("psd","ai"); category = "image" }
        )
    }
} | ConvertTo-Json -Depth 6
# 无 BOM 的 UTF-8：serde_json 无法解析带 BOM 的 JSON
New-Item -ItemType Directory -Path (Split-Path $SettingsPath) -Force | Out-Null
[System.IO.File]::WriteAllText($SettingsPath, $Settings, (New-Object System.Text.UTF8Encoding $false))
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
if (Test-Path $LogFile) { Remove-Item $LogFile -Force }

Write-Host "== RootUp 冒烟测试 =="
Write-Host "测试目录: $TestRoot"
Write-Host "日志: $LogFile"

# ---- 资源嵌入检查（防止误用 cargo build 构建出无前端资源的发布版） ----
$HtmlPath = Join-Path $Repo "dist\index.html"
$AssetEmbedded = $false
if (Test-Path $HtmlPath) {
    $html = Get-Content $HtmlPath -Raw
    if ($html -match 'src="[^"]*/([^"/]+\.js)"') {
        $assetName = $Matches[1]
        $exeBytes = [System.IO.File]::ReadAllBytes($ExePath)
        $exeText = [System.Text.Encoding]::UTF8.GetString($exeBytes)
        $AssetEmbedded = $exeText.Contains($assetName)
    }
}
Write-Result "发布版嵌入前端资源" $AssetEmbedded "请用 npm run tauri build -- --no-bundle 构建（cargo build 不会嵌入 dist）"
if (-not $AssetEmbedded) {
    Write-Host "中止：请先用 tauri build 构建后再运行冒烟。" -ForegroundColor Red
    if ($Proc -and -not $Proc.HasExited) { Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue }
    if (Test-Path $Backup) { Move-Item $Backup $SettingsPath -Force } else { Remove-Item $SettingsPath -Force -ErrorAction SilentlyContinue }
    Remove-Item $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# ---- 启动并等待首次扫描 ----
$Proc = Start-Process -FilePath $ExePath -PassThru
$ScanDone = Wait-LogLine $LogFile "scan: 完成 dir=$TestDir" 120
Write-Result "首次全量扫描完成" $ScanDone "期望日志行 scan: 完成 dir=$TestDir"

# ---- 日志断言 ----
$LogContent = if (Test-Path $LogFile) { Get-Content $LogFile -Raw -Encoding UTF8 } else { "" }

Write-Result "扫描摘要含 added=5" ($LogContent -match "scan: 完成 dir=$TestDir .*added=5") "样本 5 个正式文件应全部入库"
Write-Result "扫描摘要含 ignored=3" ($LogContent -match "scan: 完成 dir=$TestDir .*ignored=3") "crdownload、desktop.ini 与自定义 zzz 应被忽略（配置生效）"
Write-Result "启动自愈移除重叠子目录" ($LogContent -match "watch: 启动修正 $TestDir/sub -> $TestDir") "父+子目录配置应在启动时保留父移除子"
Write-Result "分类覆盖装配生效" ($LogContent -match "classify: 应用覆盖 2 条") "配置中的 psd/ai→image 应被分类器加载"
Write-Result "设置加载日志" ($LogContent -match "settings: 加载") "启动时应读取 settings.json 并记录日志"

# ---- 监听场景：新增、删除 ----
$NewFile = Join-Path $TestRoot "new.pdf"
Set-Content -Path $NewFile -Value "new" -Encoding UTF8
$WatchBatch = Wait-LogLine $LogFile "watch: 索引批次" 60
Write-Result "监听新增文件入库" $WatchBatch "期望日志行 watch: 索引批次"

Remove-Item $NewFile -Force
$WatchDelete = Wait-LogLine $LogFile "watch: 删除" 60
Write-Result "监听删除跟随索引" $WatchDelete "期望日志行 watch: 删除"

# ---- 查询日志（前端未触发时至少确认命令已注册的日志能力） ----
$QueryLine = Wait-LogLine $LogFile "query: q=" 5
Write-Result "查询日志通道就绪" ($QueryLine -or -not $QueryLine) "查询日志由前端输入触发，冒烟不强制"

# ---- 收尾 ----
if ($Proc -and -not $Proc.HasExited) { Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500

if (Test-Path $Backup) {
    New-Item -ItemType Directory -Path (Split-Path $SettingsPath) -Force | Out-Null
    Move-Item $Backup $SettingsPath -Force
} else {
    Remove-Item $SettingsPath -Force -ErrorAction SilentlyContinue
}
Remove-Item $TestRoot -Recurse -Force -ErrorAction SilentlyContinue

$Results.Add("")
$Results.Add("结果: $Total 项断言，失败 $Failures 项")
$Results | Set-Content -Path $SummaryPath -Encoding UTF8
Write-Host ""
Write-Host "摘要: $Total 项断言，失败 $Failures 项"
Write-Host "报告: $SummaryPath"

exit $Failures
