param([long]$WindowHandle, [string]$ExpectedIcon, [string]$OutputPath)

# Read the icon Windows actually associates with this window, not its constructor options.
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeWindowIcon {
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
}
'@
$iconHandle = [IntPtr]::Zero
$status = [NativeWindowIcon]::SendMessageTimeout([IntPtr]$WindowHandle, 0x7F, [IntPtr]1, [IntPtr]::Zero, 2, 3000, [ref]$iconHandle)
if ($status -eq [IntPtr]::Zero -or $iconHandle -eq [IntPtr]::Zero) { throw 'Window has no native application icon' }
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$actual = $icon.ToBitmap()
$source = [System.Drawing.Image]::FromFile($ExpectedIcon)
$expected = [System.Drawing.Bitmap]::new($actual.Width, $actual.Height)
$graphics = [System.Drawing.Graphics]::FromImage($expected)
try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, $actual.Width, $actual.Height)
    $difference = 0.0
    for ($y = 0; $y -lt $actual.Height; $y++) {
        for ($x = 0; $x -lt $actual.Width; $x++) {
            $a = $actual.GetPixel($x, $y)
            $b = $expected.GetPixel($x, $y)
            $difference += [Math]::Abs($a.R - $b.R) + [Math]::Abs($a.G - $b.G) + [Math]::Abs($a.B - $b.B) + [Math]::Abs($a.A - $b.A)
        }
    }
    $meanDifference = $difference / ($actual.Width * $actual.Height * 4)
    $actual.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($meanDifference -gt 12) { throw "Native icon differs from approved artwork: $meanDifference" }
    @{ width = $actual.Width; height = $actual.Height; meanChannelDifference = $meanDifference; maximumDifference = 12 } | ConvertTo-Json -Compress
} finally {
    $graphics.Dispose()
    $expected.Dispose()
    $source.Dispose()
    $actual.Dispose()
    $icon.Dispose()
}
