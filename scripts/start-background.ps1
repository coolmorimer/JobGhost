$ErrorActionPreference = 'Stop'
$jobghostRoot = Split-Path -Parent $PSScriptRoot
$jobghostPython = Join-Path $jobghostRoot 'backend\.venv\Scripts\python.exe'
$jobghostLogs = Join-Path $jobghostRoot '.jobghost\logs'
if (-not (Test-Path -LiteralPath $jobghostPython)) { throw 'Сначала установите зависимости backend.' }
if (-not (Test-Path -LiteralPath (Join-Path $jobghostRoot 'frontend\dist\index.html'))) { throw 'Сначала выполните npm run build в frontend.' }
$jobghostListener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($jobghostListener) { throw 'Порт 8765 уже занят. JobGhost, возможно, уже запущен: http://127.0.0.1:8765' }
New-Item -ItemType Directory -Force -Path $jobghostLogs | Out-Null
$jobghostProcess = Start-Process -FilePath $jobghostPython -WorkingDirectory (Join-Path $jobghostRoot 'backend') -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8765' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $jobghostLogs 'server-out.log') -RedirectStandardError (Join-Path $jobghostLogs 'server-error.log') -PassThru
Write-Output "JobGhost запущен в фоне, PID $($jobghostProcess.Id). Интерфейс: http://127.0.0.1:8765"
Write-Output 'Автозапуск при входе в Windows не установлен. Пауза поиска доступна в интерфейсе.'
