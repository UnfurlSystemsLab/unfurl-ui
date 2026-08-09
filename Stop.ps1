param(
    [switch]$RemoveVolumes,
    [switch]$RemoveImages,
    [int[]]$UiPorts = @(5173, 5174, 4173)
)

$ErrorActionPreference = 'Stop'

# Guard: resolves required command-line tools before shutdown work starts.
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

# Adapter: normalizes Docker Compose v2 and legacy docker-compose invocation shapes.
function Get-ComposeCommand {
    $docker = Resolve-Tool -Name 'docker'
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

# Process-tree helper: returns all descendant process ids for a selected process.
function Get-DescendantProcessIds {
    param(
        [Parameter(Mandatory=$true)][int]$ProcessId,
        [Parameter(Mandatory=$true)]$Processes
    )
    $children = @($Processes | Where-Object { $_.ParentProcessId -eq $ProcessId })
    foreach ($child in $children) {
        $child.ProcessId
        Get-DescendantProcessIds -ProcessId $child.ProcessId -Processes $Processes
    }
}

# Shutdown strategy: stops only the local Unfurl UI dev/preview processes, not arbitrary Node apps.
function Stop-UnfurlUiProcesses {
    param(
        [Parameter(Mandatory=$true)][string]$RepoRoot,
        [Parameter(Mandatory=$true)][int[]]$Ports
    )
    $allProcesses = @(Get-CimInstance Win32_Process)
    $targetIds = New-Object 'System.Collections.Generic.HashSet[int]'
    $currentId = $PID
    $escapedRepo = [regex]::Escape($RepoRoot)
    $repoProcessPattern = "(?i)($escapedRepo|@unfurl/host-shell|launch-studio\.ps1)"
    $toolProcessPattern = "(?i)(vite|npm-cli\.js|@unfurl/host-shell|launch-studio\.ps1|node_modules.*esbuild)"

    foreach ($connection in Get-NetTCPConnection -LocalPort $Ports -State Listen -ErrorAction SilentlyContinue) {
        [void]$targetIds.Add([int]$connection.OwningProcess)
    }

    foreach ($process in $allProcesses) {
        $commandLine = $process.CommandLine
        if ($commandLine -and $commandLine -match $repoProcessPattern -and $commandLine -match $toolProcessPattern) {
            [void]$targetIds.Add([int]$process.ProcessId)
        }
    }

    foreach ($processId in @($targetIds)) {
        foreach ($childId in Get-DescendantProcessIds -ProcessId $processId -Processes $allProcesses) {
            [void]$targetIds.Add([int]$childId)
        }
    }

    $stopped = 0
    foreach ($processId in ($targetIds | Sort-Object -Descending)) {
        if ($processId -eq $currentId) {
            continue
        }
        try {
            $process = Get-Process -Id $processId -ErrorAction Stop
            Stop-Process -Id $processId -Force -ErrorAction Stop
            Write-Host "Stopped UI process $($process.ProcessName) ($processId)."
            $stopped++
        } catch {
            # It may already have exited after its parent or listener was stopped.
        }
    }

    if ($stopped -eq 0) {
        Write-Host 'No Unfurl UI dev server processes were running.'
    } else {
        Write-Host "Stopped $stopped Unfurl UI process(es)." -ForegroundColor Green
    }
}

$repoRoot = Resolve-Path $PSScriptRoot
$composeFile = Join-Path $repoRoot 'docker-compose.dependencies.yml'
if (-not (Test-Path $composeFile)) {
    throw "Compose file not found: $composeFile"
}

$compose = Get-ComposeCommand
$downArgs = $compose.Prefix + @('-f', $composeFile, 'down', '--remove-orphans')
if ($RemoveVolumes) {
    $downArgs += '--volumes'
}
if ($RemoveImages) {
    $downArgs += @('--rmi', 'local')
}

Invoke-Checked -FilePath $compose.File -Arguments $downArgs -WorkingDirectory $repoRoot
Write-Host 'Unfurl dependency containers are stopped.' -ForegroundColor Green
Stop-UnfurlUiProcesses -RepoRoot $repoRoot.Path -Ports $UiPorts
