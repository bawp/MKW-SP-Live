# Step-by-step driver for the test build: start | keys <seq> | shot <name> | stop
#   keys: comma-separated names (A,B,UP,DOWN,LEFT,RIGHT,START) with optional *N repeat, e.g. "A,DOWN*2,A"
#   -Game <folder under out> picks the build to start (default MKW-SP; MKW-SP-Rankings for the fork)
param([Parameter(Mandatory)][string]$Action, [string]$Arg = '', [int]$Delay = 700, [string]$Game = 'MKW-SP')
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
if (-not ('Drv2' -as [type])) {
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Drv2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  public static void Key(ushort scan, bool ext, bool up) {
    var i = new INPUT[1]; i[0].type = 1; i[0].ki.wScan = scan;
    i[0].ki.dwFlags = 0x0008u | (ext ? 0x0001u : 0u) | (up ? 0x0002u : 0u);
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@ }
$pidFile = Join-Path $root 'out\drive.pid'
function Get-Game { if (Test-Path $pidFile) { Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue } }
switch ($Action) {
  'start' {
    $exe = Join-Path $root "out\$Game\MKW-SP.exe"
    $p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
    $p.Id | Set-Content $pidFile; "started pid $($p.Id)"
  }
  'keys' {
    $g = Get-Game; if (-not $g) { 'game not running'; break }
    $map = @{ A = @(0x0D,0x1C,0); B = @(0x08,0x0E,0); START = @(0x50,0x19,0); UP = @(0x26,0x48,1); DOWN = @(0x28,0x50,1); LEFT = @(0x25,0x4B,1); RIGHT = @(0x27,0x4D,1)
             # raw keys, for Config.toml expression bindings (e.g. A=X, B=Z, Start=Enter, D-pad=T/G/F/H)
             X = @(0x58,0x2D,0); Z = @(0x5A,0x2C,0); C = @(0x43,0x2E,0); S = @(0x53,0x1F,0); ENTER = @(0x0D,0x1C,0); SPACE = @(0x20,0x39,0); E = @(0x45,0x12,0); Q = @(0x51,0x10,0); LSHIFT = @(0xA0,0x2A,0)
             T = @(0x54,0x14,0); G = @(0x47,0x22,0); F = @(0x46,0x21,0); H = @(0x48,0x23,0) }
    [Drv2]::SetForegroundWindow($g.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 200
    $wr = New-Object Drv2+RECT; [Drv2]::GetWindowRect($g.MainWindowHandle, [ref]$wr) | Out-Null
    [Drv2]::SetCursorPos([int](($wr.L + $wr.R) / 2), [int](($wr.T + $wr.B) / 2)) | Out-Null; [Drv2]::mouse_event(2,0,0,0,[IntPtr]::Zero); [Drv2]::mouse_event(4,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 300
    foreach ($tok in $Arg.Split(',')) {
      $name, $n = $tok.Trim().ToUpper().Split('*'); if (-not $n) { $n = 1 }
      for ($k = 0; $k -lt [int]$n; $k++) {
        $s = $map[$name]; [Drv2]::keybd_event([byte]$s[0], [byte]$s[1], [uint32]$s[2], [IntPtr]::Zero); Start-Sleep -Milliseconds 350; [Drv2]::keybd_event([byte]$s[0], [byte]$s[1], [uint32]($s[2] -bor 2), [IntPtr]::Zero)
        Start-Sleep -Milliseconds $Delay
      }
    }
    "sent $Arg"
  }
  'shot' {
    $g = Get-Game; if (-not $g) { 'game not running'; break }
    $h = $g.MainWindowHandle; $r = New-Object Drv2+RECT; [Drv2]::GetClientRect($h, [ref]$r) | Out-Null
    $bmp = New-Object System.Drawing.Bitmap ([Math]::Max(1,$r.R)), ([Math]::Max(1,$r.B))
    $gr = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $gr.GetHdc(); [Drv2]::PrintWindow($h, $hdc, 3) | Out-Null; $gr.ReleaseHdc($hdc)
    $small = New-Object System.Drawing.Bitmap $bmp, 854, 480
    $file = Join-Path $root "out\drive_$Arg.png"; $small.Save($file); $gr.Dispose(); $bmp.Dispose(); $small.Dispose(); $file
  }
  'click' {
    # Arg: "x,y" in the 854x480 coordinates of the saved shots
    $g = Get-Game; if (-not $g) { 'game not running'; break }
    $h = $g.MainWindowHandle; $r = New-Object Drv2+RECT; [Drv2]::GetClientRect($h, [ref]$r) | Out-Null
    $xy = $Arg.Split(','); $pt = New-Object Drv2+POINT; $pt.X = [int]([double]$xy[0] * $r.R / 854); $pt.Y = [int]([double]$xy[1] * $r.B / 480)
    [Drv2]::ClientToScreen($h, [ref]$pt) | Out-Null; [Drv2]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 150
    [Drv2]::SetCursorPos($pt.X, $pt.Y) | Out-Null; Start-Sleep -Milliseconds 100; [Drv2]::mouse_event(2,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 80; [Drv2]::mouse_event(4,0,0,0,[IntPtr]::Zero)
    "clicked $Arg"
  }
  'fullshot' {
    $g = Get-Game; if (-not $g) { 'game not running'; break }
    $h = $g.MainWindowHandle; $r = New-Object Drv2+RECT; [Drv2]::GetClientRect($h, [ref]$r) | Out-Null
    $bmp = New-Object System.Drawing.Bitmap ([Math]::Max(1,$r.R)), ([Math]::Max(1,$r.B))
    $gr = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $gr.GetHdc(); [Drv2]::PrintWindow($h, $hdc, 3) | Out-Null; $gr.ReleaseHdc($hdc)
    $file = Join-Path $root "out/full_$Arg.png"; $bmp.Save($file); $gr.Dispose(); $bmp.Dispose(); "$file $($r.R)x$($r.B)"
  }
  'stop' { $g = Get-Game; if ($g) { Stop-Process -Id $g.Id -Force; 'stopped' } else { 'not running' } }
}
