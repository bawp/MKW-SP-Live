# Builds MKW-SP Live on this PC from your own WiiCompiled install and Mario Kart Wii
# (PAL) game files. No game code or disc files come with the kit: the game code is translated and
# compiled here, from your copy, the same way WiiCompiled itself is built. The kit's custom HD texture
# pack is installed into the game's UserData.
#
# Run it through "Build MKW-SP Live.bat" next to this folder, or:
#   powershell -ExecutionPolicy Bypass -File files\build.ps1 [-InstallDir <WiiCompiled install folder>]
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:APPDATA 'CT-MKWII\Recomp\Install')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$Files = $PSScriptRoot                                   # ...\MKW-SP Live Kit\files
$KitRoot = Split-Path -Parent $Files
$Work = Join-Path $KitRoot 'work'
$Game = Join-Path $KitRoot 'MKW-SP Live'
# Before the rename the game was built into "MKW-SP Rankings": keep its saves and settings
$OldGame = Join-Path $KitRoot 'MKW-SP Rankings'
if ((Test-Path -LiteralPath $OldGame) -and -not (Test-Path -LiteralPath $Game)) { Rename-Item -LiteralPath $OldGame -NewName 'MKW-SP Live' }
$ExpectedVersion = '0.9.2'

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$arguments, $what, $log) {
    # Windows PowerShell turns a redirected native program's stderr lines into errors, which 'Stop'
    # makes fatal (the translator prints notes there); only the exit code decides here.
    $ErrorActionPreference = 'Continue'
    if ($log) {
        & $exe @arguments *> $log
    } else {
        & $exe @arguments
    }
    if ($LASTEXITCODE -ne 0) {
        if ($log) { Get-Content $log -Tail 30 | Write-Host }
        Fail "$what failed (exit code $LASTEXITCODE).$(if ($log) { " Full log: $log" })"
    }
}

# ---------------------------------------------------------------- checks
Step 'Checking your setup'
$installState = Join-Path $InstallDir 'install-state.json'
if (-not (Test-Path -LiteralPath $installState)) {
    Fail "WiiCompiled is not installed at $InstallDir.`nInstall WiiCompiled with your Mario Kart Wii (PAL) game first, or pass -InstallDir."
}
$state = Get-Content -LiteralPath $installState -Raw | ConvertFrom-Json
if ($state.ProductVersion -ne $ExpectedVersion) {
    Write-Host "Warning: this kit was made for WiiCompiled $ExpectedVersion; you have $($state.ProductVersion). The build may not apply." -ForegroundColor Yellow
}
$installWorkspace = Join-Path $InstallDir 'BuildWorkspace'
$toolkit = Join-Path $InstallDir 'Toolkit'
$translator = Join-Path $toolkit 'Translator\Translator.Cli.exe'
$gameData = Join-Path $InstallDir 'GameAssets\DATA'
foreach ($required in @((Join-Path $installWorkspace 'Assets\main.dol'), (Join-Path $installWorkspace 'Assets\StaticR.rel'), $translator, (Join-Path $gameData 'sys\fst.bin'))) {
    if (-not (Test-Path -LiteralPath $required)) { Fail "Missing $required.`nReinstall WiiCompiled (with the toolkit) from your Mario Kart Wii (PAL) game." }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again." }
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) { Fail "Node.js 18 or newer is needed (you have $(& node --version))." }
Write-Host "WiiCompiled $($state.ProductVersion) at $InstallDir, Node.js $(& node --version)"

$env:MKWSP_WIICOMPILED_INSTALL = $InstallDir
[IO.Directory]::CreateDirectory($Work) | Out-Null
$logs = Join-Path $Work 'logs'
[IO.Directory]::CreateDirectory($logs) | Out-Null

# ---------------------------------------------------------------- workspace
Step 'Preparing a private copy of the WiiCompiled build workspace (your install is not changed)'
$ws = Join-Path $Work 'BuildWorkspace'
if (-not (Test-Path -LiteralPath (Join-Path $ws '.mkwsp-kit-patches'))) {
    if (Test-Path -LiteralPath $ws) { Remove-Item -LiteralPath $ws -Recurse -Force }
    & robocopy $installWorkspace $ws /E /XD (Join-Path $installWorkspace 'native-build') (Join-Path $installWorkspace 'build') /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "Copying $installWorkspace failed (robocopy $LASTEXITCODE)." }
}
$patches = Get-ChildItem -LiteralPath (Join-Path $Files 'patches') -Filter '*.patch' | Sort-Object Name | ForEach-Object FullName
Run 'node' (@((Join-Path $Files 'apply-patch.js'), $ws) + $patches) 'Applying the MKW-SP runtime patches'

# ---------------------------------------------------------------- convert
Step 'Converting the MKW-SP payload for this game'
$convertOut = Join-Path $Work 'convert'
Run 'node' @((Join-Path $Files 'tools\convert.js'), $convertOut, '--rankings') 'Converting MKW-SP' (Join-Path $logs 'convert.log')
$codePul = Join-Path $convertOut 'Binaries\Code.pul'
Run 'node' @((Join-Path $Files 'tools\verify.js'), $codePul) 'Checking the converted payload' (Join-Path $logs 'verify.log')
$pack = Join-Path $ws 'PulsarPacks\completed\MKW-SP'
[IO.Directory]::CreateDirectory((Join-Path $pack 'Binaries')) | Out-Null
Copy-Item -LiteralPath $codePul -Destination (Join-Path $pack 'Binaries\Code.pul') -Force

# ---------------------------------------------------------------- translate
Step 'Translating the game and MKW-SP (this takes a while)'
$project = Join-Path $ws 'projects\mkwii\recomp.yml'
$generated = Join-Path $ws 'generated'
$threads = [string][Math]::Max(1, [Environment]::ProcessorCount)
Push-Location $ws
try {
    Run $translator @('translate-recursive', '0x800060A4', '--project', $project, '--outdir', (Join-Path $generated 'functions'),
        '--output-metadata', (Join-Path $generated 'base_translation_output.json'),
        '--production-source-bundle', (Join-Path $generated 'base_translation_sources.bin'),
        '--no-function-files', '--prune-stale', '--threads', $threads) 'Translating the game' (Join-Path $logs 'translate-base.log')
    Run $translator @('emit-base-manifest', '--project', $project, '--out', (Join-Path $ws 'build\base'),
        '--functions-dir', (Join-Path $generated 'functions'),
        '--translation-output-metadata', (Join-Path $generated 'base_translation_output.json'), '--region', 'P') 'Writing the base manifest' (Join-Path $logs 'emit-manifest.log')
    Run $translator @('translate-mod', '--project', $project, '--profile', 'mkw-sp',
        '--base-manifest', (Join-Path $ws 'build\base\mkwii_base_manifest.json'),
        '--base-translation-output-metadata', (Join-Path $generated 'base_translation_output.json'),
        '--code-pul', (Join-Path $pack 'Binaries\Code.pul'), '--mod-root', $pack, '--mod-name', 'MKW-SP', '--region', 'P',
        '--out', (Join-Path $ws 'build\mods\mkw_sp_full_cpp'), '--prefer-cached-inputs', '--emit-cpp', '--threads', $threads,
        '--skip-retro-wfc') 'Translating MKW-SP' (Join-Path $logs 'translate-mod.log')
} finally { Pop-Location }

# ---------------------------------------------------------------- compile
Step 'Compiling MKW-SP (this takes a while)'
$exeOut = Join-Path $Work 'exe'
$compiled = $true
try {
    & (Join-Path $Files 'BuildMkwSp.ps1') -Workspace $ws -OutputDirectory $exeOut -Toolkit $toolkit *> (Join-Path $logs 'compile.log')
} catch {
    $_ | Out-String | Add-Content (Join-Path $logs 'compile.log')
    $compiled = $false
}
if (-not $compiled -or -not (Test-Path -LiteralPath (Join-Path $exeOut 'MKW-SP.exe'))) {
    Get-Content (Join-Path $logs 'compile.log') -Tail 30 | Write-Host
    Fail "Compiling failed. Full log: $(Join-Path $logs 'compile.log')"
}

# ---------------------------------------------------------------- game folder
Step "Setting up $Game"
[IO.Directory]::CreateDirectory($Game) | Out-Null
& robocopy $exeOut $Game /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "Copying the game files failed (robocopy $LASTEXITCODE)." }
Set-Content -LiteralPath (Join-Path $Game 'portable.txt') -Value 'portable' -Encoding ascii
$userData = Join-Path $Game 'UserData'
[IO.Directory]::CreateDirectory($userData) | Out-Null
$config = Join-Path $userData 'Config.toml'
if (-not (Test-Path -LiteralPath $config)) {
    $dvd = $gameData.Replace('\', '\\')
    $toml = "# MKW-SP Live`n`n[paths]`ndvd_root = `"$dvd`"`n"
    [IO.File]::WriteAllText($config, $toml, (New-Object Text.UTF8Encoding $false))
}
# MKW-SP's channel data (texts, layouts) lives in the NAND title folder; the runtime creates the rest
# of the NAND (UserData\NAND) on first launch, with its own console identity.
$titleData = Join-Path $userData 'NAND\title\00010001\53505350\data'
[IO.Directory]::CreateDirectory($titleData) | Out-Null
Copy-Item -LiteralPath (Join-Path $Files 'nand\contents.arc') -Destination (Join-Path $titleData 'contents.arc') -Force
# The MKW-SP Channel's buttons as the Mario Kart Channel's (icons included), made from your own disc's
# Channel.szs; it needs xz (Git for Windows has it), else the channel keeps MKW-SP's buttons.
Remove-Item -LiteralPath (Join-Path $titleData 'contents.arc.pre-rankings') -ErrorAction SilentlyContinue
# Git for Windows only puts Git\cmd on PATH; its xz is in mingw64\bin (or usr\bin)
if (-not (Get-Command xz -ErrorAction SilentlyContinue)) {
    $gitRoots = @("$env:ProgramFiles\Git", "${env:ProgramFiles(x86)}\Git", "$env:LOCALAPPDATA\Programs\Git")
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) { $gitRoots = @(Split-Path -Parent (Split-Path -Parent $git.Source)) + $gitRoots }
    foreach ($bin in $gitRoots | ForEach-Object { "$_\mingw64\bin"; "$_\usr\bin" }) {
        if (Test-Path -LiteralPath (Join-Path $bin 'xz.exe')) { $env:Path = "$bin;$env:Path"; break }
    }
}
if (Get-Command xz -ErrorAction SilentlyContinue) {
    $ErrorActionPreference = 'Continue'   # stderr lines are not failures (see Run)
    & node (Join-Path $Files 'tools\rankings-ui.js') (Join-Path $titleData 'contents.arc') *> (Join-Path $logs 'channel-buttons.log')
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { Write-Host 'Note: the Mario Kart Channel buttons could not be made; the channel keeps MKW-SP''s.' -ForegroundColor Yellow }
    Remove-Item -LiteralPath (Join-Path $titleData 'contents.arc.pre-rankings') -ErrorAction SilentlyContinue
} else {
    Write-Host 'Note: xz not found (it comes with Git for Windows); the channel keeps MKW-SP''s plain buttons.' -ForegroundColor Yellow
}
$sd = Join-Path $userData 'WiiSD.raw'
if (-not (Test-Path -LiteralPath $sd)) { Run 'node' @((Join-Path $Files 'make-sd.js'), $sd) 'Creating the SD card' }

# ---------------------------------------------------------------- HD textures
# The kit's HD texture pack goes to UserData\texture_replacements (files of yours there are kept);
# its Globe folder has the globe in a GPU format (no hitch the first time the Continental view
# zooms in).
Step 'Installing the HD textures'
$pack = Join-Path $userData 'texture_replacements'
if (Test-Path -LiteralPath (Join-Path $Files 'texture_replacements')) {
    & robocopy (Join-Path $Files 'texture_replacements') $pack /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "Copying the HD textures failed (robocopy $LASTEXITCODE)." }
    Write-Host ("{0} HD textures in {1}" -f (Get-ChildItem -LiteralPath $pack -Recurse -File).Count, $pack)
} else {
    # The pack is its own download (the GitHub release's HD texture zips, unzipped into files\)
    Write-Host 'No HD texture pack in files\texture_replacements: skipped.'
}
# WiiCompiled loads them with [video] texture_replacements = true
$toml = Get-Content -LiteralPath $config -Raw
if ($toml -notmatch '(?m)^\s*texture_replacements\s*=') {
    if ($toml -match '(?m)^\[video\]\s*$') { $toml = $toml -replace '(?m)^\[video\]\s*$', "[video]`ntexture_replacements = true" }
    else { $toml = $toml.TrimEnd() + "`n`n[video]`ntexture_replacements = true`n" }
    [IO.File]::WriteAllText($config, $toml, (New-Object Text.UTF8Encoding $false))
}

Write-Host ''
Write-Host "Done. Start the game with: $(Join-Path $Game 'MKW-SP.exe')" -ForegroundColor Green
Write-Host 'Your saves, settings and downloaded rankings stay in its UserData folder; building again keeps them.'
