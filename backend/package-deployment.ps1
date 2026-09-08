# Creates an upload-ready backend ZIP. This script never calls Azure.
param(
    [string]$SourceDirectory = $PSScriptRoot,
    [string]$DestinationPath = (Join-Path $PSScriptRoot '../backend.zip')
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path
$zipPath = [System.IO.Path]::GetFullPath($DestinationPath)
if ([System.IO.Path]::GetExtension($zipPath) -ne '.zip') {
    throw 'DestinationPath must name a ZIP file.'
}

foreach ($requiredFile in @('api-server.js', 'package.json', 'package-lock.json', 'build-info.json', '.deployment')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $requiredFile) -PathType Leaf)) {
        throw "Missing required deployment file: $requiredFile"
    }
}

function Get-DeploymentFiles([string]$Directory) {
    foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
        if ($item.Name -in @('node_modules', '.git', '.azure', '.tmp', '__tests__', 'coverage', 'logs')) {
            continue
        }
        if ($item.Name -like '.env*' -or $item.Extension -in @('.log', '.zip')) {
            continue
        }
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "Deployment source contains a link; use regular files: $($item.FullName)"
        }
        if ($item.PSIsContainer) {
            Get-DeploymentFiles $item.FullName
        } else {
            $item
        }
    }
}

$deploymentFiles = @(Get-DeploymentFiles $sourceRoot)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zipStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
try {
    $zip = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($file in $deploymentFiles) {
            $entryName = $file.FullName.Substring($sourceRoot.TrimEnd('\', '/').Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $zip.Dispose()
    }
} finally {
    $zipStream.Dispose()
}

$sizeMb = [Math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
Write-Host "Packaged $($deploymentFiles.Count) files ($sizeMb MB): $zipPath"
