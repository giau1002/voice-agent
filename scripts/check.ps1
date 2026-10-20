. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $ProjectRoot
Invoke-Checked '.venv/Scripts/python.exe' @('-m','pytest','-q')
Push-Location 'web'
try {
    Invoke-Checked 'npm.cmd' @('test')
    Invoke-Checked 'npm.cmd' @('run','build')
} finally { Pop-Location }
