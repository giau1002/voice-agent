param([switch]$CloudLiveKit, [int]$RunForSeconds = 0)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $ProjectRoot
$python = Join-Path $ProjectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run scripts/setup.ps1 first' }
if (-not (Test-Path -LiteralPath '.env')) { throw 'Copy .env.example to .env and fill provider keys first' }
if (-not (Test-Path -LiteralPath 'web/dist/index.html')) { throw 'Build web/ first: npm run build' }
New-Item -ItemType Directory -Path 'logs' -Force | Out-Null
$children = @()
try {
    if (-not $CloudLiveKit) {
        $livekit = Join-Path $ProjectRoot '.tools/livekit/livekit-server.exe'
        if (-not (Test-Path -LiteralPath $livekit)) { throw 'Run setup or pass -CloudLiveKit' }
        $livekitConfig = Join-Path $ProjectRoot 'deploy/livekit.local.yaml'
        $children += Start-Process -FilePath $livekit -ArgumentList @('--config',$livekitConfig,'--bind','127.0.0.1','--node-ip','127.0.0.1') -WindowStyle Hidden -PassThru -RedirectStandardOutput 'logs/livekit.out.log' -RedirectStandardError 'logs/livekit.err.log'
    }
    $children += Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','voice_agent.api:app','--host','127.0.0.1','--port','8790') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput 'logs/api.out.log' -RedirectStandardError 'logs/api.err.log'
    $children += Start-Process -FilePath $python -ArgumentList @('-m','voice_agent.worker','start') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput 'logs/worker.out.log' -RedirectStandardError 'logs/worker.err.log'
    Write-Host 'Open http://127.0.0.1:8790 - press Ctrl+C here to stop. Logs: ./logs/'
    $deadline = if ($RunForSeconds -gt 0) { (Get-Date).AddSeconds($RunForSeconds) } else { [datetime]::MaxValue }
    while ((Get-Date) -lt $deadline) {
        foreach ($process in $children) {
            $process.Refresh()
            if ($process.HasExited) { throw "Process $($process.Id) exited; inspect logs/" }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    foreach ($process in $children) {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    }
}
