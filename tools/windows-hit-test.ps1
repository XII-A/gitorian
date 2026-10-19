param([long]$WindowHandle, [int]$PointX, [int]$PointY)

# Query Windows' native hit target without moving the user's pointer. Browser
# input injection bypasses native caption drag regions and cannot catch ghosts.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeHit {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
}
'@
[NativeHit]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$packedPoint = ($PointY -shl 16) -bor ($PointX -band 65535)
$hitResult = [IntPtr]::Zero
$status = [NativeHit]::SendMessageTimeout([IntPtr]$WindowHandle, 0x84, [IntPtr]::Zero, [IntPtr]$packedPoint, 2, 3000, [ref]$hitResult)
if ($status -eq [IntPtr]::Zero) { throw 'Native window hit test timed out' }
$hitResult.ToInt64()
