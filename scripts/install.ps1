$repo = Split-Path -Parent $PSScriptRoot
python -m venv "$repo\backend\.venv"
& "$repo\backend\.venv\Scripts\python.exe" -m pip install -e "$repo\backend[dev]"
npm --prefix "$repo\frontend" install

