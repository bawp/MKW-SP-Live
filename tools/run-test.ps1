# Copy the freshly built exe into the portable test folder, run it for N seconds, print the log tail.
param([int]$Seconds = 25, [int]$Tail = 60)
$root = Split-Path -Parent $PSScriptRoot
Copy-Item -Force (Join-Path $root 'out\MKW-SP-build\MKW-SP.exe') (Join-Path $root 'out\MKW-SP\MKW-SP.exe')
$logs = Join-Path $root 'out\MKW-SP\UserData\Logs'
if (Test-Path $logs) { Remove-Item -Recurse -Force $logs }
$exe = Join-Path $root 'out\MKW-SP\MKW-SP.exe'
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru -RedirectStandardOutput (Join-Path $root 'out\run-stdout.txt') -RedirectStandardError (Join-Path $root 'out\run-stderr.txt')
$exited = $p.WaitForExit($Seconds * 1000)
if (-not $exited) { Stop-Process -Id $p.Id -Force; "still running after ${Seconds}s (killed)" } else { "exited with code $($p.ExitCode)" }
$console = Get-ChildItem $logs -Recurse -Filter console.log -ErrorAction SilentlyContinue | Select-Object -First 1
if ($console) { Get-Content $console.FullName -Tail $Tail } else { Get-Content (Join-Path $root 'out\run-stdout.txt') -Tail $Tail }
