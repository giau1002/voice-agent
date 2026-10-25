# Locate the private CUDA environment without moving or recreating it.
function Resolve-AvatarCudaRuntime {
    param([string]$BundleRoot, [string]$RuntimePath = '')
    function Test-CudaRuntime([string]$Candidate) {
        return ((Test-Path -LiteralPath (Join-Path $Candidate 'uv/uv.exe') -PathType Leaf) -and
                (Test-Path -LiteralPath (Join-Path $Candidate 'musetalk-venv/Scripts/python.exe') -PathType Leaf))
    }
    $BundleRoot = [System.IO.Path]::GetFullPath($BundleRoot)
    if ($RuntimePath) {
        $Resolved = (Resolve-Path -LiteralPath $RuntimePath -ErrorAction Stop).Path
        foreach ($Candidate in @($Resolved, (Join-Path $Resolved '.runtime'))) {
            if (Test-CudaRuntime $Candidate) { return $Candidate }
        }
        throw 'RuntimePath must point to the CUDA-check folder or its .runtime directory (containing uv and musetalk-venv).'
    }
    $OwnRuntime = Join-Path $BundleRoot '.runtime'
    if (Test-CudaRuntime $OwnRuntime) { return $OwnRuntime }
    $Parent = Split-Path $BundleRoot -Parent
    $Candidates = @()
    if ($Parent) {
        $ParentRuntime = Join-Path $Parent '.runtime'
        if (Test-CudaRuntime $ParentRuntime) { $Candidates += $ParentRuntime }
        # Only immediate sibling folders; no recursive/full-drive scanning.
        foreach ($Directory in Get-ChildItem -LiteralPath $Parent -Directory -Force -ErrorAction SilentlyContinue) {
            $Candidate = Join-Path $Directory.FullName '.runtime'
            if (Test-CudaRuntime $Candidate) { $Candidates += $Candidate }
        }
    }
    $Candidates = @($Candidates | Sort-Object -Unique)
    if ($Candidates.Count -eq 1) { return $Candidates[0] }
    if ($Candidates.Count -gt 1) {
        throw ("Multiple CUDA environments found. Choose one with -RuntimePath:`n" + ($Candidates -join "`n"))
    }
    throw 'CUDA environment not found beside this folder. Run again with -RuntimePath "C:\path\to\avatar-gpu-check" using the folder where setup.ps1 succeeded.'
}
