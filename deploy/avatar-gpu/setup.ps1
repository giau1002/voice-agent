param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$BundleRoot = $PSScriptRoot
$RuntimeRoot = Join-Path $BundleRoot '.runtime'
$UvVersion = '0.13.3'
$UvHash = 'bb701bd35b586c45966654ea2703c9bd116a6a4fc0a8ca755bd644c2c41c5ebe'
$UvUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"

if ($DryRun) {
    Write-Output "Private runtime: $RuntimeRoot"
    Write-Output 'Downloads: uv 0.13.3, Python 3.10.19, PyTorch 2.0.1/cu118 (MuseTalk upstream baseline).'
    Write-Output 'Runs a small CUDA FP16/FP32 check. Writes logs/setup.log and cuda-report.json.'
    Write-Output 'No model download, service changes, firewall changes, or global Python changes.'
    return
}

function Invoke-Checked {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Exe" }
}

# Keep all managed Python, cache and environments private to this directory.
$PriorEnv = @{}
foreach ($name in @('UV_PYTHON_INSTALL_DIR','UV_CACHE_DIR','PYTHONUTF8','PYTHONNOUSERSITE','CUDA_VISIBLE_DEVICES')) {
    $PriorEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
New-Item -ItemType Directory -Force -Path $RuntimeRoot,(Join-Path $BundleRoot 'logs') | Out-Null
Start-Transcript -Path (Join-Path $BundleRoot 'logs/setup.log') -Append | Out-Null
try {
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $RuntimeRoot 'python'
    $env:UV_CACHE_DIR = Join-Path $RuntimeRoot 'cache'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONNOUSERSITE = '1'
    $env:CUDA_VISIBLE_DEVICES = '0'
    $Archive = Join-Path $BundleRoot 'uv-windows.zip'
    if (-not (Test-Path -LiteralPath $Archive)) {
        Invoke-WebRequest -UseBasicParsing -Uri $UvUrl -OutFile $Archive
    }
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $UvHash) {
        throw 'uv archive checksum mismatch. Nothing was executed.'
    }
    $UvDir = Join-Path $RuntimeRoot 'uv'
    Expand-Archive -LiteralPath $Archive -DestinationPath $UvDir -Force
    $Uv = Join-Path $UvDir 'uv.exe'
    if (-not (Test-Path -LiteralPath $Uv)) { throw 'uv.exe missing from verified archive.' }
    $Venv = Join-Path $RuntimeRoot 'musetalk-venv'
    $Python = Join-Path $Venv 'Scripts/python.exe'
    Invoke-Checked $Uv @('python','install','3.10.19','--no-bin','--no-registry','--no-config')
    if (-not (Test-Path -LiteralPath $Python)) {
        Invoke-Checked $Uv @('venv',$Venv,'--python','3.10.19','--managed-python','--no-config')
    }
    Invoke-Checked $Uv @('pip','install','--python',$Python,'--no-config','numpy==1.23.5')
    Invoke-Checked $Uv @('pip','install','--python',$Python,'--no-config','--index-url','https://download.pytorch.org/whl/cu118','torch==2.0.1','torchvision==0.15.2','torchaudio==2.0.2')
    Invoke-Checked $Python @((Join-Path $BundleRoot 'check_cuda.py'),'--output',(Join-Path $BundleRoot 'cuda-report.json'))
    Write-Output 'CUDA check passed. Send cuda-report.json for the avatar model installation step.'
    Write-Output 'This check does NOT install or benchmark MuseTalk, or change the running chatbot.'
} finally {
    foreach ($name in $PriorEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $PriorEnv[$name], 'Process') }
    Stop-Transcript | Out-Null
}
