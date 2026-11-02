param([int]$TargetProcess, [int]$WatchProcess)
$ErrorActionPreference = 'Stop'
# Pin the original process handle before the caller authorizes any termination.
$target = [System.Diagnostics.Process]::GetProcessById($TargetProcess)
$null = $target.Handle
$created = $target.StartTime.ToUniversalTime()
[Console]::Out.WriteLine('ready')
if ([Console]::In.ReadLine() -ne 'go') { exit 2 }
if (-not $target.WaitForExit(8000)) {
    # Exclude the watchdog branch, which owns the independent recovery UI and this helper.
    $snapshot = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate)
    $owned = [System.Collections.Generic.List[object]]::new()
    function Collect-Owned([int]$parentProcess, [datetime]$parentCreated) {
        foreach ($item in $snapshot) {
            if ($item.ParentProcessId -eq $parentProcess -and $item.ProcessId -ne $WatchProcess -and
                $item.CreationDate.ToUniversalTime() -ge $parentCreated) {
                Collect-Owned ([int]$item.ProcessId) $item.CreationDate.ToUniversalTime()
                $owned.Add($item)
            }
        }
    }
    Collect-Owned $TargetProcess $created
    foreach ($item in $owned) {
        try {
            $child = [System.Diagnostics.Process]::GetProcessById([int]$item.ProcessId)
            $null = $child.Handle
            # A stale/reused PID is not authority to terminate an unrelated process.
            $nativeTicks = $child.StartTime.ToUniversalTime().Ticks
            $recordedTicks = $item.CreationDate.ToUniversalTime().Ticks
            if ($child.StartTime.ToUniversalTime() -ge $created -and
                ($nativeTicks - ($nativeTicks % 10)) -eq ($recordedTicks - ($recordedTicks % 10))) {
                $child.Kill()
                $null = $child.WaitForExit(5000)
            }
            $child.Dispose()
        } catch [System.ArgumentException] { }
    }
    if (-not $target.HasExited) { $target.Kill() }
    if (-not $target.WaitForExit(5000)) { throw 'Owned desktop did not exit' }
}
$target.Dispose()
[Console]::Out.WriteLine('exited')
