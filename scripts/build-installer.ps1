param([string]$Version='0.5.2')
$ErrorActionPreference='Stop'
$jobghostRoot=Split-Path -Parent $PSScriptRoot
$jobghostStage=Join-Path $jobghostRoot ('.jobghost\build-'+[guid]::NewGuid().ToString('N'))
$jobghostPython=Join-Path $jobghostRoot 'backend\.venv\Scripts\python.exe'
$jobghostCompiler='C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
if(-not(Test-Path -LiteralPath $jobghostCompiler)){throw 'Установите Inno Setup 6 для сборки установщика.'}
New-Item -ItemType Directory -Path $jobghostStage | Out-Null
Push-Location (Join-Path $jobghostRoot 'frontend')
try {npm run build;if($LASTEXITCODE){throw 'Сборка интерфейса не прошла'}} finally {Pop-Location}
Push-Location (Join-Path $jobghostRoot 'backend')
try {
  & $jobghostPython -m PyInstaller --noconfirm --onedir --console --name jobghost-server --distpath (Join-Path $jobghostStage 'server-dist') --workpath (Join-Path $jobghostStage 'server-work') --specpath $jobghostStage --collect-submodules app --collect-all faster_whisper --collect-all ctranslate2 --collect-all av --collect-all onnxruntime --collect-all tokenizers --collect-all tiktoken --collect-all playwright --collect-all nvidia.cublas --collect-all qdrant_client --collect-all fastembed --hidden-import aiosqlite --hidden-import sqlalchemy.dialects.sqlite.aiosqlite --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.protocols.websockets.auto --hidden-import uvicorn.lifespan.on desktop_entry.py
  if($LASTEXITCODE){throw 'Сборка локального сервера не прошла'}
} finally {Pop-Location}
$jobghostApp=Join-Path $jobghostStage 'app'
New-Item -ItemType Directory -Path $jobghostApp | Out-Null
Copy-Item -Path (Join-Path $jobghostRoot 'desktop\node_modules\electron\dist\*') -Destination $jobghostApp -Recurse
Rename-Item -LiteralPath (Join-Path $jobghostApp 'electron.exe') -NewName 'JobGhost.exe'
$jobghostResources=Join-Path $jobghostApp 'resources'
$jobghostDesktop=Join-Path $jobghostResources 'app'
New-Item -ItemType Directory -Path $jobghostDesktop -Force | Out-Null
Copy-Item -Path (Join-Path $jobghostRoot 'desktop\*.cjs') -Destination $jobghostDesktop -Exclude '*.test.cjs','test-*.cjs'
Copy-Item -LiteralPath (Join-Path $jobghostRoot 'desktop\package.json') -Destination $jobghostDesktop
Copy-Item -LiteralPath (Join-Path $jobghostRoot 'desktop\region.html'),(Join-Path $jobghostRoot 'desktop\region-ui.js') -Destination $jobghostDesktop
New-Item -ItemType Directory -Path (Join-Path $jobghostDesktop 'node_modules') | Out-Null
Copy-Item -LiteralPath (Join-Path $jobghostRoot 'desktop\node_modules\koffi') -Destination (Join-Path $jobghostDesktop 'node_modules') -Recurse
New-Item -ItemType Directory -Path (Join-Path $jobghostDesktop 'node_modules\@koromix') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $jobghostRoot 'desktop\node_modules\@koromix\koffi-win32-x64') -Destination (Join-Path $jobghostDesktop 'node_modules\@koromix') -Recurse
Copy-Item -LiteralPath (Join-Path $jobghostStage 'server-dist\jobghost-server') -Destination (Join-Path $jobghostResources 'server') -Recurse
Copy-Item -LiteralPath (Join-Path $jobghostRoot 'frontend\dist') -Destination (Join-Path $jobghostResources 'frontend') -Recurse
Copy-Item -LiteralPath (Join-Path $jobghostRoot 'browser-extension') -Destination (Join-Path $jobghostResources 'browser-extension') -Recurse
$jobghostSpeechCache=Join-Path $jobghostRoot '.jobghost\models\models--mobiuslabsgmbh--faster-whisper-large-v3-turbo\snapshots'
$jobghostSpeechSnapshot=Get-ChildItem -LiteralPath $jobghostSpeechCache -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not $jobghostSpeechSnapshot){throw 'Модель Whisper large-v3-turbo не найдена. Запустите JobGhost один раз и дождитесь статуса речи «Готово».'}
Copy-Item -LiteralPath $jobghostSpeechSnapshot.FullName -Destination (Join-Path $jobghostResources 'speech-model') -Recurse
& $jobghostCompiler "/DSourceDir=$jobghostApp" "/DAppVersion=$Version" (Join-Path $jobghostRoot 'installer\JobGhost.iss')
if($LASTEXITCODE){throw 'Inno Setup завершился с ошибкой'}
Write-Output "BUILD_STAGE=$jobghostStage"
Write-Output "INSTALLER=$(Join-Path $jobghostRoot "releases\JobGhost-Setup-$Version.exe")"
