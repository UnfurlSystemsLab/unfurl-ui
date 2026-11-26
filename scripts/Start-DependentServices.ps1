<#
.SYNOPSIS
Starts the Lab service containers Studio talks to in dev and preview modes (Fabric Studio :7878, Foundry :7979,
Flow :8080) and waits for their health endpoints.

.DESCRIPTION
The one implementation of service startup, used by Startup.ps1 and scripts/launch-studio.ps1 so they cannot drift.

Image source, in order of precedence:
- -LocalImages: builds the images from the local checkouts with Publish-DependentImages.ps1 -Local (offline Maven from
  ~/.m2, each service module cleaned first), names them unfurl-<name>:local, and starts them without pulling. Use this
  instead of registry images that may be stale. -SkipImageBuild reuses unfurl-<name>:local images built earlier.
- -NoPull: starts the registry-named images already on this machine and never pulls: `docker compose up --pull never`,
  so a missing image fails rather than being fetched.
- Default: pulls the registry images (<Registry>/<Owner>/<name>:<ImageTag>), then starts them.

Foundry credentials stay outside source: ../.debug/foundry.env or the shell (UNFURL_FOUNDRY_CREDENTIAL_KEY is required).
#>
param(
    [string]$Registry = 'ghcr.io',
    [string]$Owner = 'unfurlsystemslab',
    [string]$ImageTag = '0.1.0-snapshot',
    [switch]$NoPull,
    [switch]$LocalImages,
    [switch]$SkipImageBuild
)

$ErrorActionPreference = 'Stop'

if ($SkipImageBuild -and -not $LocalImages) {
    throw '-SkipImageBuild applies to -LocalImages only'
}

# Guard: resolves required command-line tools before startup work starts.
function Resolve-Tool {
    param([Parameter(Mandatory=$true)][string]$Name)
    $tool = Get-Command $Name -ErrorAction SilentlyContinue
    if ($tool) { return $tool.Source }
    throw "$Name was not found on PATH"
}

# Runner: invokes a native command and converts non-zero exits into clear script failures. Success is the exit code
# alone: docker and compose write progress to stderr, which Windows PowerShell turns into error records when output is
# redirected (for example `.\Startup.ps1 *> startup.log`), so stderr must not stop the script.
function Invoke-Checked {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [string]$WorkingDirectory = (Get-Location).Path
    )
    Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkCyan
    Push-Location $WorkingDirectory
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $FilePath @Arguments 2>&1 | ForEach-Object { Write-Host "$_" }
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
        Pop-Location
    }
    if ($exitCode -ne 0) {
        throw "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
    }
}

# Environment guard: verifies Docker Desktop or another Docker engine is reachable.
function Assert-DockerEngine {
    param([Parameter(Mandatory=$true)][string]$Docker)
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo.FileName = $Docker
    $process.StartInfo.Arguments = 'info'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.CreateNoWindow = $true
    $null = $process.Start()
    if (-not $process.WaitForExit(10000)) {
        $process.Kill()
        throw 'Docker is installed, but the Docker engine check timed out. Start Docker Desktop and wait for the Linux engine before starting Lab services.'
    }
    if ($process.ExitCode -ne 0) {
        throw 'Docker is installed, but the Docker engine is not reachable. Start Docker Desktop and wait for the Linux engine before starting Lab services.'
    }
}

# Adapter: normalizes Docker Compose v2 and legacy docker-compose invocation shapes.
function Get-ComposeCommand {
    $docker = Resolve-Tool -Name 'docker'
    Assert-DockerEngine -Docker $docker
    & $docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        return [pscustomobject]@{ File = $docker; Prefix = @('compose'); V2 = $true }
    }
    $legacy = Get-Command docker-compose -ErrorAction SilentlyContinue
    if ($legacy) {
        return [pscustomobject]@{ File = $legacy.Source; Prefix = @(); V2 = $false }
    }
    throw 'Docker Compose was not found. Install Docker Desktop or docker-compose.'
}

# Projector: creates the container-facing Foundry deployment root and rewrites local tool URLs.
function Initialize-FoundryDeploymentRoot {
    param(
        [Parameter(Mandatory=$true)][string]$SourceRoot,
        [Parameter(Mandatory=$true)][string]$TargetRoot
    )
    if (-not (Test-Path $SourceRoot)) {
        throw "Foundry deployment source is missing: $SourceRoot"
    }
    if (Test-Path $TargetRoot) {
        Remove-Item -LiteralPath $TargetRoot -Recurse -Force
    }
    Copy-Item -LiteralPath $SourceRoot -Destination $TargetRoot -Recurse -Force
    $toolsFile = Join-Path $TargetRoot 'registries/tools.yaml'
    if (Test-Path $toolsFile) {
        $content = Get-Content -Raw $toolsFile
        $content = $content -replace 'http://127\.0\.0\.1:7878', 'http://unfurl-fabric:7878'
        $content = $content -replace 'http://localhost:7878', 'http://unfurl-fabric:7878'
        Set-Content -Path $toolsFile -Value $content -NoNewline
    }
}

# Health gate: waits for one HTTP endpoint before moving to the next startup phase.
function Wait-Http {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [int]$Attempts = 90
    )
    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "Timed out waiting for $Url"
}

# Naming rule: the image each service runs, by image source. Local images are the ones Publish-DependentImages.ps1
# -Local builds: unfurl-<name>:local, with no registry prefix.
function Get-ServiceImages {
    $names = [ordered]@{ UNFURL_FABRIC_IMAGE = 'unfurl-fabric-studio'; UNFURL_FOUNDRY_IMAGE = 'unfurl-foundry'; UNFURL_FLOW_IMAGE = 'unfurl-flow' }
    $images = [ordered]@{}
    foreach ($entry in $names.GetEnumerator()) {
        $images[$entry.Key] = if ($LocalImages) {
            "$($entry.Value):local"
        } else {
            ("{0}/{1}/{2}:{3}" -f $Registry, $Owner, $entry.Value, $ImageTag).ToLowerInvariant()
        }
    }
    return $images
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$workspaceRoot = Resolve-Path (Join-Path $repoRoot '..')

# Loaded here too, since launch-studio.ps1 calls this script directly; loading twice sets the same values.
. (Join-Path $PSScriptRoot 'Import-StudioEnvironment.ps1')
Import-StudioEnvironment

if (-not $env:UNFURL_FOUNDRY_CREDENTIAL_KEY) {
    throw 'UNFURL_FOUNDRY_CREDENTIAL_KEY is required for Foundry. Put it in ../.debug/foundry.env or set it in the shell.'
}

$compose = Get-ComposeCommand
$neverPull = $NoPull -or $LocalImages
if ($neverPull -and -not $compose.V2) {
    throw '-NoPull and -LocalImages start the stack with "docker compose up --pull never", which needs Docker Compose v2.'
}

if ($LocalImages) {
    $builder = Join-Path $PSScriptRoot 'Publish-DependentImages.ps1'
    if ($SkipImageBuild) {
        Write-Host 'Using the unfurl-<name>:local images built earlier (no Maven or Docker build).' -ForegroundColor Cyan
    } else {
        Write-Host 'Building the service images from the local checkouts (offline Maven, clean)...' -ForegroundColor Cyan
        & $builder -Local
        if ($LASTEXITCODE -ne 0) { throw 'Building the local service images failed' }
    }
}

$images = Get-ServiceImages
foreach ($entry in $images.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
}
if ($neverPull) {
    # Never pull means every image must already be on this machine; name the missing one instead of letting compose fail.
    $docker = Resolve-Tool -Name 'docker'
    foreach ($image in $images.Values) {
        & $docker image inspect $image *> $null
        if ($LASTEXITCODE -ne 0) {
            $hint = if ($LocalImages) { 'build it with scripts/Publish-DependentImages.ps1 -Local, or run without -SkipImageBuild' } else { 'pull it, or use -LocalImages' }
            throw "Image $image is not on this machine and will not be pulled; $hint."
        }
    }
}

$startupRoot = Join-Path $repoRoot '.startup'
New-Item -ItemType Directory -Path $startupRoot -Force | Out-Null
Initialize-FoundryDeploymentRoot `
    -SourceRoot (Join-Path $workspaceRoot 'unfurl-foundry/deployment') `
    -TargetRoot (Join-Path $startupRoot 'foundry-deployment')

$composeFile = Join-Path $repoRoot 'docker-compose.dependencies.yml'
if (-not $neverPull) {
    Invoke-Checked -FilePath $compose.File -Arguments ($compose.Prefix + @('-f', $composeFile, 'pull')) -WorkingDirectory $repoRoot
}
$up = $compose.Prefix + @('-f', $composeFile, 'up', '-d')
if ($neverPull) { $up += @('--pull', 'never') }
# A rebuilt local image keeps its tag, so recreate the containers: a running one never keeps the previous build.
if ($LocalImages) { $up += '--force-recreate' }
Invoke-Checked -FilePath $compose.File -Arguments $up -WorkingDirectory $repoRoot

Wait-Http -Url 'http://127.0.0.1:7878/health'
Wait-Http -Url 'http://127.0.0.1:7979/health'
Wait-Http -Url 'http://127.0.0.1:8080/health'

Write-Host 'Lab services are running:' -ForegroundColor Green
foreach ($image in $images.Values) { Write-Host "  $image" }
