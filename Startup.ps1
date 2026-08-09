param(
    [ValidateSet('dev', 'fixture', 'preview')]
    [string]$Mode = 'dev',

    [string]$Registry = 'ghcr.io',
    [string]$Owner = 'unfurlsystemslab',
    [string]$ImageTag = '0.1.0-snapshot',

    [int]$Port = 5173,
    [switch]$NoOpen,
    [switch]$NoPull,
    [switch]$PublishImages,
    [switch]$SkipImageBuild,
    [switch]$NoUi
)

$ErrorActionPreference = 'Stop'

# Guard: resolves required command-line tools before startup work starts.
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
        throw 'Docker is installed, but the Docker engine check timed out. Start Docker Desktop and wait for the Linux engine before starting Lab services.'
    }
    if ($process.ExitCode -ne 0) {
        throw 'Docker is installed, but the Docker engine is not reachable. Start Docker Desktop and wait for the Linux engine before starting Lab services.'
    }
}

# Configuration loader: imports local development env files without committing secrets.
function Import-DotEnv {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path $Path)) { return }
    foreach ($rawLine in Get-Content $Path) {
        $line = $rawLine.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#') -or -not $line.Contains('=')) { continue }
        $parts = $line.Split('=', 2)
        $name = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($name) {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

# Adapter: normalizes Docker Compose v2 and legacy docker-compose invocation shapes.
function Get-ComposeCommand {
    $docker = Resolve-Tool -Name 'docker'
    Assert-DockerEngine -Docker $docker
    & $docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        return [pscustomobject]@{ File = $docker; Prefix = @('compose') }
    }
    $legacy = Get-Command docker-compose -ErrorAction SilentlyContinue
    if ($legacy) {
        return [pscustomobject]@{ File = $legacy.Source; Prefix = @() }
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

$repoRoot = Resolve-Path $PSScriptRoot
$workspaceRoot = Resolve-Path (Join-Path $repoRoot '..')

Import-DotEnv -Path (Join-Path $workspaceRoot '.debug/foundry.env')
Import-DotEnv -Path (Join-Path $repoRoot '.env')

$env:UNFURL_FABRIC_IMAGE = ("{0}/{1}/unfurl-fabric-studio:{2}" -f $Registry, $Owner, $ImageTag).ToLowerInvariant()
$env:UNFURL_FOUNDRY_IMAGE = ("{0}/{1}/unfurl-foundry:{2}" -f $Registry, $Owner, $ImageTag).ToLowerInvariant()
$env:UNFURL_FLOW_IMAGE = ("{0}/{1}/unfurl-flow:{2}" -f $Registry, $Owner, $ImageTag).ToLowerInvariant()

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
    if (-not $env:UNFURL_FOUNDRY_CREDENTIAL_KEY) {
        throw 'UNFURL_FOUNDRY_CREDENTIAL_KEY is required for Foundry. Put it in ../.debug/foundry.env or set it in the shell.'
    }
    $startupRoot = Join-Path $repoRoot '.startup'
    New-Item -ItemType Directory -Path $startupRoot -Force | Out-Null
    Initialize-FoundryDeploymentRoot `
        -SourceRoot (Join-Path $workspaceRoot 'unfurl-foundry/deployment') `
        -TargetRoot (Join-Path $startupRoot 'foundry-deployment')

    $compose = Get-ComposeCommand
    $composeFile = Join-Path $repoRoot 'docker-compose.dependencies.yml'
    if (-not $NoPull) {
        Invoke-Checked -FilePath $compose.File -Arguments ($compose.Prefix + @('-f', $composeFile, 'pull')) -WorkingDirectory $repoRoot
    }
    Invoke-Checked -FilePath $compose.File -Arguments ($compose.Prefix + @('-f', $composeFile, 'up', '-d')) -WorkingDirectory $repoRoot

    Wait-Http -Url 'http://127.0.0.1:7878/health'
    Wait-Http -Url 'http://127.0.0.1:7979/health'
    Wait-Http -Url 'http://127.0.0.1:8080/health'
}

if (-not $NoUi) {
    $launcher = Join-Path $repoRoot 'scripts/launch-studio.ps1'
    if ($NoOpen) {
        & $launcher -Mode $Mode -Port $Port -NoOpen
    } else {
        & $launcher -Mode $Mode -Port $Port
    }
}
