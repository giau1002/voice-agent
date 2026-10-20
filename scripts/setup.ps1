param([string]$NodePath = '', [string]$UvPath = '')
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $ProjectRoot
New-Item -ItemType Directory -Path '.tools' -Force | Out-Null

function Get-GitHubBinary {
    param([string]$Repository, [string]$AssetName, [string]$Destination, [string]$Tag = '')
    $route = if ($Tag) { "tags/$Tag" } else { 'latest' }
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/$route"
    $asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (-not $asset -or -not $asset.digest.StartsWith('sha256:')) { throw 'Missing verified release asset' }
    $archive = Join-Path $ProjectRoot ".tools/$AssetName"
    Invoke-WebRequest $asset.browser_download_url -OutFile $archive
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $asset.digest.Substring(7)) { throw 'Downloaded file checksum mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath $Destination -Force
}

if ($NodePath) { $env:PATH = (Split-Path $NodePath -Parent) + ';' + $env:PATH }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing Node.js 24 LTS locally...'
    $release = Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.version -like 'v24.*' -and $_.lts } | Select-Object -First 1
    if (-not $release) { throw 'Node.js 24 LTS not found' }
    $version = $release.version
    $filename = "node-$version-win-x64.zip"
    $base = "https://nodejs.org/dist/$version"
    $checksums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
    $expected = (($checksums -split "`n" | Where-Object { $_ -match [regex]::Escape($filename) + '$' }) -split '\s+')[0]
    $archive = Join-Path $ProjectRoot '.tools/node.zip'
    Invoke-WebRequest "$base/$filename" -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node checksum mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath '.tools/node-extracted' -Force
    New-Item -ItemType Directory -Path '.tools/node' -Force | Out-Null
    Get-ChildItem -LiteralPath ".tools/node-extracted/node-$version-win-x64" | Copy-Item -Destination '.tools/node' -Recurse -Force
    $env:PATH = (Join-Path $ProjectRoot '.tools/node') + ';' + $env:PATH
}
if ($UvPath) { $env:PATH = (Split-Path $UvPath -Parent) + ';' + $env:PATH }
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing uv locally...'
    Get-GitHubBinary 'astral-sh/uv' 'uv-x86_64-pc-windows-msvc.zip' '.tools/uv'
    $env:PATH = (Join-Path $ProjectRoot '.tools/uv') + ';' + $env:PATH
}
if (-not (Test-Path -LiteralPath '.tools/livekit/livekit-server.exe')) {
    Write-Host 'Installing LiveKit server locally...'
    Get-GitHubBinary 'livekit/livekit' 'livekit_1.13.10_windows_amd64.zip' '.tools/livekit' 'v1.13.10'
}
Invoke-Checked 'uv' @('sync', '--frozen')
Invoke-Checked '.venv/Scripts/python.exe' @('-m', 'livekit.agents', 'download-files')
Push-Location 'web'
try {
    Invoke-Checked 'npm.cmd' @('ci', '--no-fund')
    Invoke-Checked 'npm.cmd' @('run', 'build')
} finally { Pop-Location }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
Write-Host 'Setup complete. Fill SONIOX_API_KEY and an LLM key in .env, then run scripts/start.ps1.'
