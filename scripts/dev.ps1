param([ValidateSet('all','backend','frontend','mcp')][string]$Target='all')
$repo = Split-Path -Parent $PSScriptRoot
if ($Target -in @('all','backend')) { Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoExit','-Command',"Set-Location '$repo\backend'; .\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8765" }
if ($Target -in @('all','frontend')) { Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoExit','-Command',"Set-Location '$repo\frontend'; npm run dev" }
if ($Target -eq 'mcp') { Set-Location "$repo\backend"; .\.venv\Scripts\python -m app.mcp.server }
