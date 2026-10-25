param([string]$RuntimePath = '', [switch]$SkipRun, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$BundleRoot = $PSScriptRoot
$RuntimeRoot = Join-Path $BundleRoot '.runtime'
if ($DryRun) {
    Write-Output 'Uses the existing private CUDA environment from setup.ps1.'
    Write-Output 'Installs inference-only dependencies; downloads 3.71 GiB of pinned model files.'
    Write-Output 'Renders a 6.5-second Vietnamese quality pilot; no LiveKit or production changes.'
    return
}
. (Join-Path $BundleRoot 'resolve-runtime.ps1')
$CudaRuntimeRoot = Resolve-AvatarCudaRuntime -BundleRoot $BundleRoot -RuntimePath $RuntimePath
$Uv = Join-Path $CudaRuntimeRoot 'uv/uv.exe'
$Python = Join-Path $CudaRuntimeRoot 'musetalk-venv/Scripts/python.exe'
Write-Output "Using existing CUDA environment: $CudaRuntimeRoot"
$Drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($BundleRoot))
if ($Drive.AvailableFreeSpace -lt 15GB) { throw 'Need at least 15 GiB disk space for dependencies/models/results.' }
function Invoke-Checked {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Exe" }
}
$PriorEnv = @{}
foreach ($name in @('UV_CACHE_DIR','PYTHONUTF8','PYTHONNOUSERSITE','CUDA_VISIBLE_DEVICES','HF_HOME','HF_HUB_DISABLE_IMPLICIT_TOKEN')) {
    $PriorEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
New-Item -ItemType Directory -Force -Path (Join-Path $BundleRoot 'logs') | Out-Null
Start-Transcript -Path (Join-Path $BundleRoot 'logs/setup-model.log') -Append | Out-Null
try {
    $env:UV_CACHE_DIR = Join-Path $CudaRuntimeRoot 'cache'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONNOUSERSITE = '1'
    $env:CUDA_VISIBLE_DEVICES = '0'
    $env:HF_HOME = Join-Path $RuntimeRoot 'hf-cache'
    $env:HF_HUB_DISABLE_IMPLICIT_TOKEN = '1'
    Invoke-Checked $Python @((Join-Path $BundleRoot 'check_cuda.py'),'--output',(Join-Path $BundleRoot 'cuda-report.json'))
    Invoke-Checked $Uv @('pip','install','--python',$Python,'--no-config','--only-binary',':all:',
        '--extra-index-url','https://download.pytorch.org/whl/cu118',
        '-r',(Join-Path $BundleRoot 'requirements-pilot.txt'),'-c',(Join-Path $BundleRoot 'constraints-pilot.txt'))
    Invoke-Checked $Python @((Join-Path $BundleRoot 'fetch_models.py'))
    if (-not $SkipRun) { Invoke-Checked $Python @((Join-Path $BundleRoot 'run_pilot.py')) }
} finally {
    foreach ($name in $PriorEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $PriorEnv[$name], 'Process') }
    Stop-Transcript | Out-Null
}
