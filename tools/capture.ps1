# Launch the test build and save PrintWindow captures of the game window (occlusion-safe).
param([int[]]$At = @(15, 30, 45))
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
if (-not ('PW' -as [type])) {
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class PW { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
 public struct RECT { public int L, T, R, B; } }
"@ }
Copy-Item -Force (Join-Path $root 'out\MKW-SP-build\MKW-SP.exe') (Join-Path $root 'out\MKW-SP\MKW-SP.exe')
$exe = Join-Path $root 'out\MKW-SP\MKW-SP.exe'
$g = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
$elapsed = 0
foreach ($t in $At) {
  Start-Sleep -Seconds ($t - $elapsed); $elapsed = $t
  $g.Refresh(); $h = $g.MainWindowHandle
  if ($g.HasExited -or $h -eq [IntPtr]::Zero) { "no window/exited at ${t}s"; continue }
  $r = New-Object PW+RECT; [PW]::GetClientRect($h, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ([Math]::Max(1,$r.R)), ([Math]::Max(1,$r.B))
  $gr = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $gr.GetHdc(); [PW]::PrintWindow($h, $hdc, 3) | Out-Null; $gr.ReleaseHdc($hdc)
  $file = Join-Path $root "out\shot_${t}s.png"; $bmp.Save($file); $gr.Dispose(); $bmp.Dispose(); $file
}
if (-not $g.HasExited) { Stop-Process -Id $g.Id -Force; 'still running at end (killed)' } else { "exited with code $($g.ExitCode)" }
