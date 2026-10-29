# Native build (incremental) + timed test run. Run from the PowerShell tool, not from bash.
param([int]$Seconds = 30, [int]$Tail = 60, [switch]$NoBuild)
$root = Split-Path -Parent $PSScriptRoot
if (-not $NoBuild) {
    & (Join-Path $root 'tools\BuildMkwSp.ps1') -Workspace (Join-Path $root 'sandbox\BuildWorkspace') -OutputDirectory (Join-Path $root 'out\MKW-SP-build') *> (Join-Path $root 'sandbox\native-build.log')
    if ($LASTEXITCODE -ne 0) { 'BUILD FAILED'; Select-String -Path (Join-Path $root 'sandbox\native-build.log') -Pattern 'error:|FAILED' | Select-Object -First 20 | ForEach-Object { $_.Line }; return }
    'build ok'
}
$lines = & (Join-Path $root 'tools\run-test.ps1') -Seconds $Seconds -Tail 2000
$keep = $false
$lines | Where-Object { $_ -notmatch '^\[aurora\]|stubbed|^\[os\] (EXI|PPC|SI)|^  (max|min|API|Device|Driver)' } | ForEach-Object {
    if ($_ -match '\[dvd\] published|still running|exited with') { $keep = $true }
    if ($keep) { $_ }
} | Select-Object -Last $Tail
