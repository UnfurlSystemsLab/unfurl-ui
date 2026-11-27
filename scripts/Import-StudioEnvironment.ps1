<#
.SYNOPSIS
Loads the local development environment files into the current process: ../.debug/foundry.env (workspace level), then
unfurl-ui/.env, so a value in .env wins.

.DESCRIPTION
The one place these files are loaded, dot-sourced by every entry point before it does anything that reads them:
Startup.ps1 before publishing (GHCR_USER, GHCR_TOKEN) and starting services, and Start-DependentServices.ps1 before
starting services (UNFURL_FOUNDRY_CREDENTIAL_KEY, model settings) when launch-studio.ps1 calls it directly. Loading
twice is harmless: the same values are set again. Secrets stay in these ignored files or the shell, never in source.

.EXAMPLE
. (Join-Path $PSScriptRoot 'Import-StudioEnvironment.ps1')
Import-StudioEnvironment
#>

# Configuration loader: imports one KEY=VALUE env file into the process environment; a missing file is skipped.
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

# Loads ../.debug/foundry.env, then .env, relative to the unfurl-ui repository root.
function Import-StudioEnvironment {
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
    $workspaceRoot = Resolve-Path (Join-Path $repoRoot '..')
    Import-DotEnv -Path (Join-Path $workspaceRoot '.debug/foundry.env')
    Import-DotEnv -Path (Join-Path $repoRoot '.env')
}
