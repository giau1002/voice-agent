$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$env:UV_PYTHON_INSTALL_DIR = Join-Path $ProjectRoot '.tools/python'
$env:PYTHONUTF8 = '1'
foreach ($directory in @('.tools/node', '.tools/uv')) {
    $candidate = Join-Path $ProjectRoot $directory
    if (Test-Path -LiteralPath $candidate) { $env:PATH = $candidate + ';' + $env:PATH }
}
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable exited with code $LASTEXITCODE" }
}
