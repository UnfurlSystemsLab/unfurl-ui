<#
.SYNOPSIS
Starts the Lab service containers (dev and preview modes) and then Unfurl Studio.

.DESCRIPTION
Service startup is scripts/Start-DependentServices.ps1, shared with scripts/launch-studio.ps1. Image source:
- -LocalImages: build the images from the local checkouts (offline, clean) and run them, never pulling; use this instead
  of registry images that may be stale. -SkipImageBuild reuses the unfurl-<name>:local images built earlier.
- -NoPull: run the registry images already on this machine, never pulling (a missing image fails).
- Default: pull the registry images, then run them.
-PublishImages builds and pushes the registry images before starting.
#>
param(
    [ValidateSet('dev', 'fixture', 'preview')]
    [string]$Mode = 'dev',

    [string]$Registry = 'ghcr.io',
    [string]$Owner = 'unfurlsystemslab',
    [string]$ImageTag = '0.1.0-snapshot',

    [int]$Port = 5173,
    [switch]$NoOpen,
    [switch]$NoPull,
    [switch]$LocalImages,
    [switch]$PublishImages,
    [switch]$SkipImageBuild,
    [switch]$NoUi
)

$ErrorActionPreference = 'Stop'

if ($LocalImages -and $PublishImages) {
    throw '-LocalImages runs images built for this machine; it cannot be combined with -PublishImages'
}

$repoRoot = Resolve-Path $PSScriptRoot

# The local environment files first, before anything reads them: publishing needs GHCR_USER and GHCR_TOKEN, and
# services need the Foundry credentials.
. (Join-Path $repoRoot 'scripts/Import-StudioEnvironment.ps1')
Import-StudioEnvironment

if ($PublishImages) {
    $publisher = Join-Path $repoRoot 'scripts/Publish-DependentImages.ps1'
    if ($SkipImageBuild) {
        & $publisher -Registry $Registry -Owner $Owner -ImageTag $ImageTag -Push -SkipBuild
    } else {
        & $publisher -Registry $Registry -Owner $Owner -ImageTag $ImageTag -Push
    }
    if ($LASTEXITCODE -ne 0) { throw 'Dependent image publish failed' }
}

if ($Mode -ne 'fixture') {
    $services = @{ Registry = $Registry; Owner = $Owner; ImageTag = $ImageTag }
    if ($NoPull) { $services.NoPull = $true }
    if ($LocalImages) {
        $services.LocalImages = $true
        if ($SkipImageBuild) { $services.SkipImageBuild = $true }
    }
    & (Join-Path $repoRoot 'scripts/Start-DependentServices.ps1') @services
}

if (-not $NoUi) {
    $launcher = Join-Path $repoRoot 'scripts/launch-studio.ps1'
    if ($NoOpen) {
        & $launcher -Mode $Mode -Port $Port -NoOpen
    } else {
        & $launcher -Mode $Mode -Port $Port
    }
}
