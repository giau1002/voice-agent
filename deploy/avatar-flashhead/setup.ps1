param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$RuntimeRoot = Join-Path $PSScriptRoot '.runtime'
$UvHash = 'bb701bd35b586c45966654ea2703c9bd116a6a4fc0a8ca755bd644c2c41c5ebe'
if ($DryRun) {
    Write-Output "Private runtime: $RuntimeRoot"
    Write-Output 'Python 3.10.19; PyTorch 2.7.1 CUDA 12.8; single GPU SDPA; no torch.compile.'
    Write-Output 'About 7.60 GiB model weights plus Python/CUDA packages. Allow 30 GiB free disk.'
    Write-Output 'No avatar API, account or API key. Existing MuseTalk and chatbot environments stay separate.'
    Write-Output 'Runs two warm trials. GPU performance and visual quality remain unverified until this runs.'
    return
}
function Invoke-Checked {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Exe" }
}
$PriorEnv = @{}
foreach ($name in @('UV_PYTHON_INSTALL_DIR','UV_CACHE_DIR','PYTHONUTF8','PYTHONNOUSERSITE',
                    'CUDA_VISIBLE_DEVICES','HF_HOME','HF_HUB_DISABLE_TELEMETRY','HF_HUB_OFFLINE')) {
    $PriorEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
New-Item -ItemType Directory -Force -Path $RuntimeRoot,(Join-Path $PSScriptRoot 'logs') | Out-Null
Start-Transcript -Path (Join-Path $PSScriptRoot 'logs/setup.log') -Append | Out-Null
try {
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $RuntimeRoot 'python'
    $env:UV_CACHE_DIR = Join-Path $RuntimeRoot 'cache'
    $env:HF_HOME = Join-Path $RuntimeRoot 'hf'
    $env:HF_HUB_DISABLE_TELEMETRY = '1'
    $env:HF_HUB_OFFLINE = '0'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONNOUSERSITE = '1'
    $env:CUDA_VISIBLE_DEVICES = '0'
    $Archive = Join-Path $PSScriptRoot 'uv-windows.zip'
    if (-not (Test-Path -LiteralPath $Archive)) {
        throw 'uv-windows.zip missing. Extract the complete avatar-flashhead-research.zip.'
    }
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $UvHash) {
        throw 'uv archive checksum mismatch.'
    }
    $UvDir = Join-Path $RuntimeRoot 'uv'
    Expand-Archive -LiteralPath $Archive -DestinationPath $UvDir -Force
    $Uv = Join-Path $UvDir 'uv.exe'
    Invoke-Checked $Uv @('python','install','3.10.19','--no-bin','--no-registry','--no-config')
    $Venv = Join-Path $RuntimeRoot 'venv'
    $Python = Join-Path $Venv 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $Python)) {
        Invoke-Checked $Uv @('venv',$Venv,'--python','3.10.19','--managed-python','--no-config')
    }
    Invoke-Checked $Uv @('pip','install','--python',$Python,'--no-config','--index-url',
                         'https://download.pytorch.org/whl/cu128','torch==2.7.1','torchvision==0.22.1')
    Invoke-Checked $Uv @('pip','install','--python',$Python,'--no-config','-r',
                         (Join-Path $PSScriptRoot 'requirements.txt'))
    Invoke-Checked $Python @('-u',(Join-Path $PSScriptRoot 'smoke.py'),'--require-cuda')
    Invoke-Checked $Python @((Join-Path $PSScriptRoot 'assets.py'))
    $env:HF_HUB_OFFLINE = '1'
    Invoke-Checked $Python @((Join-Path $PSScriptRoot 'benchmark.py'))
} finally {
    foreach ($name in $PriorEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $PriorEnv[$name], 'Process') }
    Stop-Transcript | Out-Null
}
