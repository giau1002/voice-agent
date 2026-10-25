# Read-only probe. Run on the GPU SERVER, not on the kiosk laptop.
# Does not install packages, change firewall rules, or read .env/credentials.
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$machine = Get-CimInstance Win32_ComputerSystem
$cpu = @(Get-CimInstance Win32_Processor)
$smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
$smiPath = if ($smi) { $smi.Source } else { $null }
if (-not $smiPath) {
    foreach ($candidate in @("$env:SystemRoot/System32/nvidia-smi.exe", "$env:ProgramFiles/NVIDIA Corporation/NVSMI/nvidia-smi.exe")) {
        if (Test-Path -LiteralPath $candidate) { $smiPath = $candidate; break }
    }
}
$gpu = @()
$gpuError = $null
if ($smiPath) {
    $rows = @(& $smiPath --query-gpu=name,driver_version,memory.total,memory.free,utilization.gpu --format=csv,noheader,nounits 2>&1)
    if ($LASTEXITCODE -eq 0) {
        $gpu = @($rows | ConvertFrom-Csv -Header name,driver,memory_total_mib,memory_free_mib,utilization_percent)
    } else { $gpuError = 'nvidia-smi failed. Run nvidia-smi manually to inspect the driver error.' }
} else { $gpuError = 'nvidia-smi not found; CUDA availability is unverified.' }
$tools = [ordered]@{}
foreach ($name in @('python', 'py', 'git', 'ffmpeg', 'wsl', 'docker')) {
    $tools[$name] = [bool](Get-Command $name -ErrorAction SilentlyContinue)
}
$report = [ordered]@{
    schema = 'avatar-server-probe-v1'
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    os = $os.Caption
    os_version = $os.Version
    cpu = @($cpu | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors)
    ram_gib = [math]::Round($machine.TotalPhysicalMemory / 1GB, 1)
    ram_free_gib = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    gpu = $gpu
    gpu_error = $gpuError
    tools_on_path = $tools
    disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
        @{ drive = $_.DeviceID; free_gib = [math]::Round($_.FreeSpace / 1GB, 1) }
    })
    note = 'Read-only hardware inventory; no inference benchmark or CUDA framework test has run.'
}
$report | ConvertTo-Json -Depth 5
