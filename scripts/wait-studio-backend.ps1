param(
    [string]$HealthUrl = 'http://127.0.0.1:7878/health',

    [int]$TimeoutSeconds = 90,

    [int]$PollMilliseconds = 500
)

$ErrorActionPreference = 'Stop'

# Guard: waits for the Fabric Studio API health port before live UI startup.
# This keeps VS Code compound launches from opening Vite while the `/studio`
# proxy target is still absent, which otherwise produces repeated ECONNREFUSED
# proxy traces instead of a useful startup failure.
function Wait-StudioBackend {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)][int]$Timeout,
        [Parameter(Mandatory=$true)][int]$PollDelay
    )

    $deadline = (Get-Date).AddSeconds($Timeout)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                Write-Host "Studio backend is ready at $Url" -ForegroundColor Green
                return
            }
            Write-Host "Studio backend returned HTTP $($response.StatusCode); waiting..."
        } catch {
            Write-Host "Waiting for Studio backend at $Url..."
        }
        Start-Sleep -Milliseconds $PollDelay
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for Studio backend at $Url. Start the Studio backend on :7878 or use fixture mode."
}

Wait-StudioBackend -Url $HealthUrl -Timeout $TimeoutSeconds -PollDelay $PollMilliseconds
