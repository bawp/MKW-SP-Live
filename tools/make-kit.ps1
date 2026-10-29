# Assembles the shareable build kit (kit/README.txt): the fork's tools, runtime patches, MKW-SP's
# loader / symbol map, the fork's contents.arc and the custom HD texture pack, plus the kit scripts.
# No game code or disc files and nothing from this PC's saves goes in: recipients build the game from
# their own WiiCompiled install.
#
#   .\tools\make-kit.ps1 [-Destination <folder>]      (default: Desktop\MKW-SP Live Kit)
[CmdletBinding()]
param([string]$Destination = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MKW-SP Live Kit'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$kit = Join-Path $root 'kit'
$files = Join-Path $Destination 'files'

if (Test-Path -LiteralPath $files) { Remove-Item -LiteralPath $files -Recurse -Force }
foreach ($dir in @('tools', 'patches', 'extracted\contents\bin', 'nand', 'licenses')) { [IO.Directory]::CreateDirectory((Join-Path $files $dir)) | Out-Null }

# Scripts (the .bat with Windows line endings)
$bat = (Get-Content -LiteralPath (Join-Path $kit 'Build MKW-SP Live.bat') -Raw) -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText((Join-Path $Destination 'Build MKW-SP Live.bat'), $bat, (New-Object Text.ASCIIEncoding))
$readme = (Get-Content -LiteralPath (Join-Path $kit 'README.txt') -Raw) -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText((Join-Path $Destination 'README.txt'), $readme, (New-Object Text.UTF8Encoding $false))
foreach ($name in @('build.ps1', 'apply-patch.js', 'make-sd.js')) { Copy-Item -LiteralPath (Join-Path $kit $name) -Destination $files }
Copy-Item -LiteralPath (Join-Path $root 'tools\BuildMkwSp.ps1') -Destination $files
Copy-Item -Path (Join-Path $kit 'licenses\*') -Destination (Join-Path $files 'licenses')

# Converter (convert.js and what it loads) and the payload check
foreach ($name in @('convert.js', 'common.js', 'analyze.js', 'vanilla.js', 'patches.js', 'ppc.js', 'killfeed.js', 'rankings.js', 'verify.js', 'kamek.js', 'rankings-ui.js', 'killfeed-messages.js')) {
    Copy-Item -LiteralPath (Join-Path $root "tools\$name") -Destination (Join-Path $files 'tools')
}
Copy-Item -Path (Join-Path $root 'patches\000*.patch') -Destination (Join-Path $files 'patches')
# The HD texture pack, installed by build.ps1 (Globe: the globe in a GPU format, tools/globe-bc1).
$pack = Join-Path $root 'out\MKW-SP\UserData\texture_replacements'
& robocopy $pack (Join-Path $files 'texture_replacements') /E /XF '*.disabled' /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copying the texture pack failed (robocopy $LASTEXITCODE)" }

# MKW-SP's loader and symbol map (from its boot.dol), and the fork's channel data
foreach ($name in @('loader.bin', 'payloadP.SMAP')) { Copy-Item -LiteralPath (Join-Path $root "extracted\contents\bin\$name") -Destination (Join-Path $files 'extracted\contents\bin') }
# The fork's channel data without what tools/rankings-ui.js makes from the disc (the vanilla channel
# buttons): made again here with --no-vanilla from MKW-SP's own contents.arc; the kit's build.ps1 adds
# the vanilla buttons from the recipient's own disc.
$kitArc = Join-Path $files 'nand\contents.arc'
Copy-Item -LiteralPath (Join-Path $root 'out\nand-rankings\title\00010001\53505350\data\contents.arc.pre-rankings') -Destination $kitArc
& node (Join-Path $root 'tools\rankings-ui.js') --no-vanilla $kitArc | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'rankings-ui.js failed' }
Remove-Item -LiteralPath ($kitArc + '.pre-rankings') -ErrorAction SilentlyContinue
# Extended Regions (assets/extended-regions: every country's flag and name) in MKW-SP's own archives
& node (Join-Path $root 'tools\extended-regions.js') $kitArc | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'extended-regions.js failed' }

$size = (Get-ChildItem -LiteralPath $Destination -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Kit written to {0} ({1:N1} MB)" -f $Destination, $size)
