param(
    [int]$Count = 100000,
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
if (-not $OutDir) { $OutDir = Join-Path $env:TEMP "rootup_bench" }

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$batch = 5000
for ($i = 0; $i -lt $Count; $i++) {
    $name = Join-Path $OutDir ("bench_{0:D6}.txt" -f $i)
    [System.IO.File]::WriteAllBytes($name, [byte[]]@())
    if (($i + 1) % $batch -eq 0) {
        Write-Host ("已生成 {0}/{1}" -f ($i + 1), $Count)
    }
}
$sw.Stop()

$sizeMb = [math]::Round((Get-ChildItem $OutDir -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "基准目录: $OutDir"
Write-Host "文件数: $Count, 总大小: ${sizeMb} MB, 生成耗时: $($sw.Elapsed.TotalSeconds) 秒"
Write-Host "在设置中添加该目录即可测试全量扫描性能（日志中查看 scan: 完成 的 files_per_sec）。"
