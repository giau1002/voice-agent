param([string]$Audio)
$ErrorActionPreference = 'Stop'
$Python = Join-Path $PSScriptRoot '.runtime/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $Python)) { throw 'Run setup.ps1 in this directory first.' }
$PriorUtf8 = $env:PYTHONUTF8
$PriorOffline = $env:HF_HUB_OFFLINE
$PriorCuda = $env:CUDA_VISIBLE_DEVICES
try {
    $env:PYTHONUTF8 = '1'
    $env:HF_HUB_OFFLINE = '1'
    $env:CUDA_VISIBLE_DEVICES = '0'
    $RunArgs = @((Join-Path $PSScriptRoot 'benchmark.py'))
    if ($Audio) { $RunArgs += @('--audio', (Resolve-Path -LiteralPath $Audio).Path) }
    & $Python @RunArgs
    if ($LASTEXITCODE -ne 0) { throw 'Benchmark failed. See outputs/*/report.json.' }
} finally {
    $env:PYTHONUTF8 = $PriorUtf8
    $env:HF_HUB_OFFLINE = $PriorOffline
    $env:CUDA_VISIBLE_DEVICES = $PriorCuda
}
