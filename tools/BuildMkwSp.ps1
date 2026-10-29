# Native build of the MKW-SP product from a sandbox copy of the WiiCompiled BuildWorkspace.
# Run tools/translate-mod.sh first (it produces build/mods/mkw_sp_full_cpp).
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Workspace,
    [Parameter(Mandatory)] [string]$OutputDirectory,
    [string]$Toolkit = (Join-Path $env:APPDATA 'CT-MKWII\Recomp\Install\Toolkit'),
    [int]$Parallel = 0
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$Workspace = [IO.Path]::GetFullPath($Workspace)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
. (Join-Path $Workspace 'NativeBuildFlags.ps1')

$translator = Join-Path $Toolkit 'Translator\Translator.Cli.exe'
$toolchain = Get-MkwBuildSafePath $Toolkit 'toolchain' 'CMake\bin\cmake.exe'
$cmake = Join-Path $toolchain 'CMake\bin\cmake.exe'
$ninja = Join-Path $toolchain 'Ninja\ninja.exe'
$toolchainBin = Join-Path $toolchain 'llvm-mingw\bin'
$project = Join-Path $Workspace 'projects\mkwii\recomp.yml'
$generated = Join-Path $Workspace 'generated'
$build = Join-Path $Workspace 'native-build'
$modOut = Join-Path $Workspace 'build\mods\mkw_sp_full_cpp'
Assert-File (Join-Path $modOut 'resolved_dispatch_profile.json') 'MKW-SP mod translation (run tools/translate-mod.sh)'

$cores = [Environment]::ProcessorCount
$memoryGiB = [math]::Max(1, [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB))
$translatedJobs = if ($Parallel -gt 0) { $Parallel } else { [math]::Max(1, [math]::Min($cores, [math]::Floor($memoryGiB / 2))) }
$globalJobs = if ($Parallel -gt 0) { $Parallel } else { [math]::Max($translatedJobs, $cores) }

$oldPath = $env:PATH
try {
    $env:PATH = Get-MkwToolchainPath $toolchain
    Push-Location $Workspace
    try {
        Invoke-Checked $translator @('generate-data-init', '--project', $project) 'Generating game data initialization' -StepId 'generate-data-init'
        Invoke-Checked $translator @(
            'emit-build-shards', '--project', $project,
            '--base-metadata', (Join-Path $generated 'base_translation_output.json'),
            '--base-functions-dir', (Join-Path $generated 'functions'),
            '--native-source-dir', (Join-Path $Workspace 'runtime\src'),
            '--out', (Join-Path $generated 'build_shards'),
            '--resolved-profile', (Join-Path $modOut 'resolved_dispatch_profile.json'),
            '--retro-cpp-dir', (Join-Path $modOut 'cpp')
        ) 'Preparing native build shards' -StepId 'emit-build-shards'

        $configure = Get-MkwNativeConfigureArguments `
            -SourceDirectory (Join-Path $Workspace 'runtime') -BuildDirectory $build `
            -Ninja $ninja -CCompiler (Join-Path $toolchainBin 'x86_64-w64-mingw32-clang.exe') `
            -CxxCompiler (Join-Path $toolchainBin 'x86_64-w64-mingw32-clang++.exe') `
            -ResourceCompiler (Join-Path $toolchainBin 'x86_64-w64-mingw32-windres.exe') `
            -DependenciesDirectory (Join-Path $Workspace 'Dependencies') `
            -NativePrebuiltDirectory (Join-Path $Workspace 'Dependencies\native_prebuilt') `
            -AdditionalArguments @("-DMKW_TRANSLATED_COMPILE_JOBS=$translatedJobs")
        Invoke-Checked $cmake $configure 'Configuring the native build' -StepId 'configure-native'
        # The mod product target is called RetroRewind in the runtime's CMake project.
        Invoke-Checked $cmake @('--build', $build, '--target', 'RetroRewind', '--parallel', $globalJobs) 'Compiling MKW-SP' -StepId 'compile'

        if (Test-Path -LiteralPath $OutputDirectory) { Remove-Item -LiteralPath $OutputDirectory -Recurse -Force }
        [IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
        Copy-Item -LiteralPath (Join-Path $build 'RetroRewind.exe') -Destination (Join-Path $OutputDirectory 'MKW-SP.exe')
        foreach ($name in @('dxcompiler.dll','dxil.dll','libc++.dll','libpng16.dll','libunwind.dll','libz.dll','libzlib1.dll','SDL3.dll','sqlite3.dll','webgpu_dawn.dll','z.dll','noshaders.zip','dsp_coef.bin','initial_pipeline_cache.db')) {
            $file = Join-Path $build $name
            if (Test-Path -LiteralPath $file -PathType Leaf) { Copy-Item -LiteralPath $file -Destination $OutputDirectory }
        }
        $redist = Join-Path $Toolkit 'Redist'
        if (Test-Path -LiteralPath $redist -PathType Container) { Copy-Item -Path (Join-Path $redist '*.dll') -Destination $OutputDirectory -Force }
        foreach ($name in @('config', 'wii_bootstrap')) {
            $directory = Join-Path $build $name
            if (Test-Path -LiteralPath $directory -PathType Container) { Copy-Item -LiteralPath $directory -Destination (Join-Path $OutputDirectory $name) -Recurse }
        }
        Write-Host "MKWCBUILD:OUTPUT=$OutputDirectory"
    } finally { Pop-Location }
} finally { $env:PATH = $oldPath }
