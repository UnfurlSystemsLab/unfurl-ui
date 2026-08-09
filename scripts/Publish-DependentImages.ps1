param(
    [string]$Registry = 'ghcr.io',
    [string]$Owner = 'unfurlsystemslab',
    [string]$ImageTag = '0.1.0-snapshot',
    [switch]$Push,
    [switch]$SkipBuild,
    [switch]$NoLatest,
    [switch]$NoCache
)

$ErrorActionPreference = 'Stop'

# Guard: resolves required command-line tools before image work starts.
function Resolve-Tool {
    param([Parameter(Mandatory=$true)][string]$Name)
    $tool = Get-Command $Name -ErrorAction SilentlyContinue
    if ($tool) { return $tool.Source }
    throw "$Name was not found on PATH"
}

# Runner: invokes a native command and converts non-zero exits into clear script failures.
function Invoke-Checked {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [string]$WorkingDirectory = (Get-Location).Path
    )
    Write-Host ">> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkCyan
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
        }
    } finally {
        Pop-Location
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

# Builder: packages one sibling service repo, builds its Docker image, and optionally pushes it to GHCR.
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
        Invoke-Checked -FilePath $Maven -Arguments @('--batch-mode', '--no-transfer-progress', '-DskipTests', 'package') -WorkingDirectory $repoPath
    }

    $image = "$Registry/$Owner/$($Service.ImageName):$ImageTag".ToLowerInvariant()
    $latest = "$Registry/$Owner/$($Service.ImageName):latest".ToLowerInvariant()
    $args = @('build', '-f', $Service.Dockerfile, '--build-arg', "JAR_FILE=$($Service.JarFile)", '-t', $image)
    if (-not $NoLatest) {
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
    },
    [pscustomobject]@{
        Name = 'Foundry Agent Host'
        Repository = 'unfurl-foundry'
        ImageName = 'unfurl-foundry'
        Dockerfile = 'Dockerfile'
        JarFile = 'target/unfurl-foundry-0.1.0-SNAPSHOT.jar'
    },
    [pscustomobject]@{
        Name = 'Flow Runtime'
        Repository = 'unfurl-flow'
        ImageName = 'unfurl-flow'
        Dockerfile = 'Dockerfile'
        JarFile = 'target/unfurl-flow-0.1.0-SNAPSHOT.jar'
    }
)

foreach ($service in $services) {
    Build-ServiceImage -Service $service -Docker $docker -Maven $mavenCommand.Source -WorkspaceRoot $workspaceRoot
}

Write-Host 'Dependent images are ready:' -ForegroundColor Green
foreach ($service in $services) {
    Write-Host ("  {0}/{1}/{2}:{3}" -f $Registry, $Owner, $service.ImageName, $ImageTag).ToLowerInvariant()
}
