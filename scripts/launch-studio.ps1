param(
    [ValidateSet('fixture', 'dev', 'preview')]
    [string]$Mode = 'fixture',

    [int]$Port = 0,

    [switch]$NoBuild,

    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

function Resolve-Npm {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npm) { return $npm.Source }
    $fallback = Get-Command npm -ErrorAction SilentlyContinue
    if ($fallback) { return $fallback.Source }
    throw 'npm was not found on PATH'
}

function New-LogPath {
    param([Parameter(Mandatory=$true)][string]$Name)
    $dir = Join-Path $env:TEMP 'unfurl-studio-logs'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    return Join-Path $dir "$Name-$([guid]::NewGuid().Guid.Substring(0, 8)).log"
}

function Assert-ProcessRunning {
    param(
        [Parameter(Mandatory=$true)]$Process,
        [Parameter(Mandatory=$true)][string]$Name,
        [Parameter(Mandatory=$true)][string]$Stdout,
        [Parameter(Mandatory=$true)][string]$Stderr
    )
    if ($Process.HasExited) {
        Write-Host "$Name exited during startup with code $($Process.ExitCode)" -ForegroundColor Red
        if (Test-Path $Stdout) {
            Write-Host "--- $Name stdout ---" -ForegroundColor Red
            Get-Content $Stdout | Select-Object -Last 80 | ForEach-Object { Write-Host $_ }
        }
        if (Test-Path $Stderr) {
            Write-Host "--- $Name stderr ---" -ForegroundColor Red
            Get-Content $Stderr | Select-Object -Last 80 | ForEach-Object { Write-Host $_ }
        }
        throw "$Name exited during startup"
    }
}

function Resolve-ServerBaseUrl {
    param(
        [Parameter(Mandatory=$true)]$Process,
        [Parameter(Mandatory=$true)][string]$Stdout,
        [Parameter(Mandatory=$true)][string]$Stderr
    )
    for ($i = 0; $i -lt 100; $i++) {
        Assert-ProcessRunning -Process $Process -Name 'Studio UI server' -Stdout $Stdout -Stderr $Stderr
        if (Test-Path $Stdout) {
            $content = Get-Content -Raw $Stdout
            $escape = [char]27
            $clean = $content -replace "$escape\[[0-?]*[ -/]*[@-~]", ''
            $matches = [regex]::Matches($clean, 'http://127\.0\.0\.1:(\d+)/')
            if ($matches.Count -gt 0) {
                $last = $matches[$matches.Count - 1]
                return "http://127.0.0.1:$($last.Groups[1].Value)"
            }
        }
        Start-Sleep -Milliseconds 200
    }
    throw 'Studio UI server did not report a local URL'
}

function Wait-Http {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)]$Process,
        [Parameter(Mandatory=$true)][string]$Stdout,
        [Parameter(Mandatory=$true)][string]$Stderr
    )
    for ($i = 0; $i -lt 80; $i++) {
        Assert-ProcessRunning -Process $Process -Name 'Studio UI server' -Stdout $Stdout -Stderr $Stderr
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    throw "Studio UI did not become reachable at $Url"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$npm = Resolve-Npm
$stdout = New-LogPath -Name "studio-$Mode-out"
$stderr = New-LogPath -Name "studio-$Mode-err"
$defaultPort = if ($Mode -eq 'preview') { 4173 } else { 5173 }
$resolvedPort = if ($Port -gt 0) { $Port } else { $defaultPort }

if ($Mode -eq 'preview' -and -not $NoBuild) {
    Write-Host 'Building Unfurl Studio production bundle...'
    Push-Location $repoRoot
    try {
        & $npm run build:studio
        if ($LASTEXITCODE -ne 0) { throw 'Studio build failed' }
    } finally {
        Pop-Location
    }
}

$arguments = if ($Mode -eq 'preview') {
    @('run', 'preview', '-w', '@unfurl/host-shell', '--', '--host', '127.0.0.1', '--port', "$resolvedPort")
} elseif ($Mode -eq 'dev') {
    @('run', 'dev:studio', '--', '--host', '127.0.0.1', '--port', "$resolvedPort")
} else {
    @('run', 'dev:studio:fixture', '--', '--host', '127.0.0.1', '--port', "$resolvedPort")
}

Write-Host "Starting Unfurl Studio ($Mode mode)..."
$server = Start-Process -FilePath $npm `
    -ArgumentList $arguments `
    -WorkingDirectory $repoRoot `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr

try {
    $baseUrl = Resolve-ServerBaseUrl -Process $server -Stdout $stdout -Stderr $stderr
    $url = "$baseUrl/components/fabric-studio/workspace"
    Wait-Http $url -Process $server -Stdout $stdout -Stderr $stderr

    Write-Host "Unfurl Studio is running at $url" -ForegroundColor Green
    Write-Host "Logs:"
    Write-Host "  stdout: $stdout"
    Write-Host "  stderr: $stderr"

    if (-not $NoOpen) {
        Start-Process $url
    }

    Write-Host 'Press Ctrl-C to stop Studio.'
    while (-not $server.HasExited) {
        Start-Sleep -Seconds 1
    }
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
}
