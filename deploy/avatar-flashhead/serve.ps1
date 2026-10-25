param([string]$BindAddress = '127.0.0.1', [int]$Port = 8890)
$ErrorActionPreference = 'Stop'
$Python = Join-Path $PSScriptRoot '.runtime/venv/Scripts/python.exe'
$Uv = Join-Path $PSScriptRoot '.runtime/uv/uv.exe'
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Extract into the FlashHead directory that already contains .runtime, or run setup.ps1 first.'
}
& $Uv pip install --python $Python --no-config -r (Join-Path $PSScriptRoot 'requirements-live.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install renderer HTTP dependency.' }
$PriorUtf8 = $env:PYTHONUTF8
$PriorOffline = $env:HF_HUB_OFFLINE
$PriorCuda = $env:CUDA_VISIBLE_DEVICES
try {
    $env:PYTHONUTF8 = '1'
    $env:HF_HUB_OFFLINE = '1'
    $env:CUDA_VISIBLE_DEVICES = '0'
    & $Python -u (Join-Path $PSScriptRoot 'service.py') --host $BindAddress --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'GPU service stopped with an error. See output above.' }
} finally {
    $env:PYTHONUTF8 = $PriorUtf8
    $env:HF_HUB_OFFLINE = $PriorOffline
    $env:CUDA_VISIBLE_DEVICES = $PriorCuda
}
