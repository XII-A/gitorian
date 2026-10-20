param([string]$Action = "sample", [long]$Handle = 0, [long]$Owner = 0)

# Native messages reach Aura's input filter. Electron sendInputEvent bypasses it.
# Input is restricted to this foreground diagnostic; no OS preference is changed.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CursorProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Info { public int Size; public int Flags; public IntPtr Cursor; public Point Position; }

    [DllImport("user32.dll", SetLastError=true)] static extern bool GetCursorInfo(ref Info info);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint value, out bool result, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", SetLastError=true)]
    static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    static Info Read() {
        var info = new Info();
        info.Size = Marshal.SizeOf(info);
        if (!GetCursorInfo(ref info)) throw new Exception("GetCursorInfo failed.");
        return info;
    }
    static void CheckPointer(IntPtr owner, Point point) {
        uint expected, actual;
        GetWindowThreadProcessId(owner, out expected);
        GetWindowThreadProcessId(WindowFromPoint(point), out actual);
        if (expected == 0 || actual != expected)
            throw new Exception("Pointer left the diagnostic window; no input sent. Keep it still during this test.");
    }
    static IntPtr Foreground(long handle) {
        var hwnd = new IntPtr(handle);
        if (GetForegroundWindow() != hwnd)
            throw new Exception("Diagnostic is not foreground; no input sent.");
        CheckPointer(hwnd, Read().Position);
        return hwnd;
    }
    public static object Snapshot(long handle) {
        var info = Read();
        if (handle != 0) CheckPointer(new IntPtr(handle), info.Position);
        bool vanish;
        SystemParametersInfo(0x1020, 0, out vanish, 0); // SPI_GETMOUSEVANISH, read only.
        return new { flags = info.Flags, cursor = info.Cursor.ToInt64().ToString(),
            x = info.Position.X, y = info.Position.Y, vanish = vanish,
            foreground = GetForegroundWindow().ToInt64().ToString() };
    }
    public static void Move(long handle) {
        var hwnd = Foreground(handle);
        var point = Read().Position;
        ScreenToClient(hwnd, ref point);
        PostMessage(hwnd, 0x200, IntPtr.Zero, new IntPtr((point.Y << 16) | (point.X & 0xffff)));
    }
    public static void Type(long handle) {
        var hwnd = Foreground(handle);
        PostMessage(hwnd, 0x100, new IntPtr(0x41), new IntPtr(0x001e0001)); // WM_KEYDOWN
        PostMessage(hwnd, 0x102, new IntPtr(0x61), new IntPtr(0x001e0001)); // WM_CHAR: a
        PostMessage(hwnd, 0x101, new IntPtr(0x41), new IntPtr(unchecked((long)0xc01e0001)));
    }
    public static void Wheel(long handle) {
        var hwnd = Foreground(handle);
        var point = Read().Position;
        PostMessage(hwnd, 0x20A, new IntPtr(120 << 16), new IntPtr((point.Y << 16) | (point.X & 0xffff)));
    }
    public static void Close(long handle, long owner) {
        var hwnd = new IntPtr(handle);
        if (handle == owner || GetWindow(hwnd, 4) != new IntPtr(owner)) // GW_OWNER
            throw new Exception("Dialog does not belong to the diagnostic; no close message sent.");
        PostMessage(hwnd, 0x10, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

try {
    switch ($Action) {
        'move' { [CursorProbe]::Move($Handle) }
        'type' { [CursorProbe]::Type($Handle) }
        'wheel' { [CursorProbe]::Wheel($Handle) }
        'close' { [CursorProbe]::Close($Handle, $Owner) }
    }
    $sampleHandle = if ($Action -eq 'close') { 0 } else { $Handle }
    [CursorProbe]::Snapshot($sampleHandle) | ConvertTo-Json -Compress
} catch {
    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
