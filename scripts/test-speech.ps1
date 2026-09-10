param(
    [Parameter()][ValidateNotNullOrEmpty()][string]$Text = 'Как работает асинхронное программирование в Пайтон?',
    [Parameter()][ValidateSet('auto','ru','en')][string]$Language = 'auto'
)
$ErrorActionPreference = 'Stop'
$jobghostRoot = Split-Path -Parent $PSScriptRoot
$jobghostPath = Join-Path $jobghostRoot '.jobghost\speech-test.wav'
$jobghostVoice = New-Object -ComObject SAPI.SpVoice
$jobghostVoices = $jobghostVoice.GetVoices()
for ($i = 0; $i -lt $jobghostVoices.Count; $i++) {
    $jobghostDescription = $jobghostVoices.Item($i).GetDescription()
    $jobghostPreferred = if ($Language -eq 'en') { $jobghostDescription -match 'Zira|David|Mark|English' } else { $jobghostDescription -match 'Irina|Pavel|Russian' }
    if ($jobghostPreferred) { $jobghostVoice.Voice = $jobghostVoices.Item($i); break }
}
$jobghostStream = New-Object -ComObject SAPI.SpFileStream
$jobghostStream.Open($jobghostPath, 3)
try {
    $jobghostVoice.AudioOutputStream = $jobghostStream
    [void]$jobghostVoice.Speak($Text)
} finally { $jobghostStream.Close() }
$jobghostAudio = [Convert]::ToBase64String([IO.File]::ReadAllBytes($jobghostPath))
Invoke-RestMethod http://127.0.0.1:8765/api/speech/transcribe -Method Post -ContentType application/json -Body (@{audio=$jobghostAudio} | ConvertTo-Json -Compress)
