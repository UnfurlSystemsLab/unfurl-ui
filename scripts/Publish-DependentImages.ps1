<#
.SYNOPSIS
Builds the Lab service images (Fabric Studio, Foundry, Flow) and optionally pushes them to the registry.

.DESCRIPTION
Default: builds registry-named images (<Registry>/<Owner>/<name>:<ImageTag>, plus :latest) and pushes them with -Push.

-Local: builds images from the local checkouts for local use only, named unfurl-<name>:local with no registry prefix, so
they can never be confused with, or replaced by, a registry image. Maven runs offline (-o) against ~/.m2, and each
service module is cleaned before it is packaged, so a shaded jar never keeps stale classes. -Local refuses -Push.

.PARAMETER Local
Build unfurl-<name>:local images from the local checkouts, offline, for Startup.ps1 / launch-studio.ps1 -LocalImages.

.PARAMETER SkipBuild
Skip the Maven build and only build the Docker images from the jars already in each repo's target folder.
#>
param(
    [string]$Registry = 'ghcr.io',
    [string]$Owner = 'unfurlsystemslab',
    [string]$ImageTag = '0.1.0-snapshot',
    [switch]$Push,
    [switch]$SkipBuild,
    [switch]$NoLatest,
    [switch]$NoCache,
    [switch]$Local
)

$ErrorActionPreference = 'Stop'

if ($Local -and $Push) {
    throw '-Local builds images for this machine only; it cannot be combined with -Push'
}

# Naming rule: the image a service is built as. Local images carry no registry prefix and the tag 'local'.
function Get-ServiceImageName {
    param([Parameter(Mandatory=$true)]$Service, [Parameter(Mandatory=$true)][string]$Tag)
    if ($Local) { return "$($Service.ImageName):local".ToLowerInvariant() }
    return "$Registry/$Owner/$($Service.ImageName):$Tag".ToLowerInvariant()
}

# Guard: resolves required command-line tools before image work starts.
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
        throw 'Docker is installed, but the Docker engine check timed out. Start Docker Desktop and wait for the Linux engine before publishing dependent images.'
    }
    if ($process.ExitCode -ne 0) {
        throw 'Docker is installed, but the Docker engine is not reachable. Start Docker Desktop and wait for the Linux engine before publishing dependent images.'
    }
}

# Builder: installs a service repo's prerequisite projects, packages the repo, builds its Docker image, and optionally pushes it to GHCR.
function Build-ServiceImage {
    param(
        [Parameter(Mandatory=$true)]$Service,
        [Parameter(Mandatory=$true)][string]$Docker,
        [Parameter(Mandatory=$true)][string]$Maven,
        [Parameter(Mandatory=$true)][string]$WorkspaceRoot
    )
    $repoPath = Join-Path $WorkspaceRoot $Service.Repository
    if (-not (Test-Path $repoPath)) {
        throw "Required repository is missing: $repoPath"
    }
    if (-not (Test-Path (Join-Path $repoPath $Service.Dockerfile))) {
        throw "Dockerfile is missing for $($Service.Name): $($Service.Dockerfile)"
    }

    if (-not $SkipBuild) {
        # Local images build offline from ~/.m2 and clean the service module first, so the shaded jar holds exactly
        # the checkout's classes.
        $mavenFlags = @('--batch-mode', '--no-transfer-progress', '-DskipTests')
        if ($Local) { $mavenFlags += '-o' }
        foreach ($prerequisite in $Service.Prerequisites) {
            Invoke-Checked -FilePath $Maven -Arguments ($mavenFlags + @('-f', $prerequisite, 'install')) -WorkingDirectory $repoPath
        }
        $goals = if ($Local) { @('clean', 'package') } else { @('package') }
        Invoke-Checked -FilePath $Maven -Arguments ($mavenFlags + $goals) -WorkingDirectory $repoPath
    }
    if (-not (Test-Path (Join-Path $repoPath $Service.JarFile))) {
        throw "The jar for $($Service.Name) is missing: $($Service.JarFile). Build it first, or run without -SkipBuild."
    }

    $image = Get-ServiceImageName -Service $Service -Tag $ImageTag
    $latest = Get-ServiceImageName -Service $Service -Tag 'latest'
    $args = @('build', '-f', $Service.Dockerfile, '--build-arg', "JAR_FILE=$($Service.JarFile)", '-t', $image)
    if (-not $NoLatest -and -not $Local) {
        $args += @('-t', $latest)
    }
    if ($NoCache) {
        $args += '--no-cache'
    }
    $args += '.'
    Invoke-Checked -FilePath $Docker -Arguments $args -WorkingDirectory $repoPath

    if ($Push) {
        Invoke-Checked -FilePath $Docker -Arguments @('push', $image) -WorkingDirectory $repoPath
        if (-not $NoLatest) {
            Invoke-Checked -FilePath $Docker -Arguments @('push', $latest) -WorkingDirectory $repoPath
        }
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$workspaceRoot = Resolve-Path (Join-Path $repoRoot '..')
$docker = Resolve-Tool -Name 'docker'
Assert-DockerEngine -Docker $docker
$mavenCommand = Get-Command mvn.cmd -ErrorAction SilentlyContinue
if (-not $mavenCommand) {
    $mavenCommand = Get-Command mvn -ErrorAction SilentlyContinue
}
if (-not $mavenCommand) {
    throw 'mvn was not found on PATH'
}

if ($Push -and $env:GHCR_USER -and ($env:GHCR_TOKEN -or $env:GITHUB_TOKEN)) {
    $token = if ($env:GHCR_TOKEN) { $env:GHCR_TOKEN } else { $env:GITHUB_TOKEN }
    $token | & $docker login $Registry -u $env:GHCR_USER --password-stdin
    if ($LASTEXITCODE -ne 0) { throw "Docker login failed for $Registry" }
} elseif ($Push) {
    Write-Host 'No GHCR_USER/GHCR_TOKEN provided; assuming docker is already logged in to GHCR.' -ForegroundColor Yellow
}

$services = @(
    [pscustomobject]@{
        Name = 'Fabric Studio'
        Repository = 'unfurl-fabric'
        ImageName = 'unfurl-fabric-studio'
        Dockerfile = 'Dockerfile'
        JarFile = 'target/unfurl-fabric-studio-server.jar'
        Prerequisites = @()
    },
    [pscustomobject]@{
        Name = 'Foundry Agent Host'
        Repository = 'unfurl-foundry'
        ImageName = 'unfurl-foundry'
        Dockerfile = 'Dockerfile'
        JarFile = 'target/unfurl-foundry-0.1.0-SNAPSHOT.jar'
        # Packaging Foundry copies its provider plugins into target/providers for the image, so they install first.
        Prerequisites = @('foundry-conversation-api/pom.xml', 'foundry-provider-api/pom.xml', 'providers/pom.xml')
    },
    [pscustomobject]@{
        Name = 'Flow Runtime'
        Repository = 'unfurl-flow'
        ImageName = 'unfurl-flow'
        Dockerfile = 'Dockerfile'
        JarFile = 'target/unfurl-flow-0.1.0-SNAPSHOT.jar'
        Prerequisites = @()
    }
)

foreach ($service in $services) {
    Build-ServiceImage -Service $service -Docker $docker -Maven $mavenCommand.Source -WorkspaceRoot $workspaceRoot
}

Write-Host 'Dependent images are ready:' -ForegroundColor Green
foreach ($service in $services) {
    Write-Host "  $(Get-ServiceImageName -Service $service -Tag $ImageTag)"
}
