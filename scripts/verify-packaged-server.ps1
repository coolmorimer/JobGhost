[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Stage,
    [int]$Port = 8770
)

$ErrorActionPreference = 'Stop'
$jobghostRoot = Split-Path -Parent $PSScriptRoot
$server = Join-Path $Stage 'resources\server\jobghost-server.exe'
$dataDirectory = Join-Path $Stage 'resources\.jobghost\packaged-auto-verify'

if (-not (Test-Path -LiteralPath $server)) {
    throw "Packaged server was not found: $server"
}

New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
$previousPort = $env:JOBGHOST_PORT
$previousTestPort = $env:JOBGHOST_TEST_PORT
$previousData = $env:JOBGHOST_USER_DATA
$env:JOBGHOST_PORT = "$Port"
$env:JOBGHOST_TEST_PORT = "$Port"
$env:JOBGHOST_USER_DATA = $dataDirectory

$serverProcess = Start-Process -FilePath $server -WindowStyle Hidden -PassThru
try {
    $ready = $false
    # The frozen speech stack can take about 30 seconds on its first cold start.
    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) {
        throw 'Packaged server did not become healthy.'
    }

    & (Join-Path $jobghostRoot 'backend\.venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'verify-packaged-server.py')
    if ($LASTEXITCODE -ne 0) {
        throw "Packaged server verifier failed with exit code $LASTEXITCODE."
    }
}
finally {
    if (Get-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $serverProcess.Id -Force
    }
    $env:JOBGHOST_PORT = $previousPort
    $env:JOBGHOST_TEST_PORT = $previousTestPort
    $env:JOBGHOST_USER_DATA = $previousData
}
