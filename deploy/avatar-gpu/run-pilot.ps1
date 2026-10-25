param([string]$RuntimePath = '', [string]$Audio = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'resolve-runtime.ps1')
$CudaRuntimeRoot = Resolve-AvatarCudaRuntime -BundleRoot $PSScriptRoot -RuntimePath $RuntimePath
$Python = Join-Path $CudaRuntimeRoot 'musetalk-venv/Scripts/python.exe'
$Arguments = @((Join-Path $PSScriptRoot 'run_pilot.py'))
if ($Audio) { $Arguments += @('--audio', $Audio) }
& $Python @Arguments
exit $LASTEXITCODE
