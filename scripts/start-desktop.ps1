$ErrorActionPreference = 'Stop'
$jobghostRoot = Split-Path -Parent $PSScriptRoot
$jobghostElectron = Join-Path $jobghostRoot 'desktop\node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $jobghostElectron)) { throw 'Выполните npm install из папки desktop.' }
Start-Process -FilePath $jobghostElectron -ArgumentList ('"' + (Join-Path $jobghostRoot 'desktop') + '"') -WorkingDirectory $jobghostRoot
