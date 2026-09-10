// Real Electron MediaRecorder -> WebM -> local Whisper. Synthetic input only.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const input=fs.readFileSync(path.join(root,'.jobghost/speech-test.wav'));
app.setName('JobGhost Audio Pipeline Test');
app.whenReady().then(async()=>{
  let win;
  const watchdog=setTimeout(()=>{console.error('AUDIO_PIPELINE_TIMEOUT');app.exit(1);},45000);
  try {
    win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'jobghost-audio-test',backgroundThrottling:false}});
    await win.loadURL('http://127.0.0.1:8765');
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const status=await fetch('/api/speech/status').then(r=>r.json());
      if(status.state!=='ready') throw Error('Local speech model not ready');
      const bytes=Uint8Array.from(atob(${JSON.stringify(input.toString('base64'))}),c=>c.charCodeAt(0));
      const context=new AudioContext();
      const destination=context.createMediaStreamDestination();
      let recorder,source;
      try {
        const buffer=await context.decodeAudioData(bytes.buffer);
        if(buffer.duration>15) throw Error('Synthetic fixture unexpectedly long');
        await context.resume();
        source=context.createBufferSource();source.buffer=buffer;source.connect(destination);
        recorder=new MediaRecorder(destination.stream);
        const chunks=[];
        const recording=new Promise((resolve,reject)=>{
          recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
          recorder.onerror=()=>reject(Error('MediaRecorder error'));
          recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType}));
        });
        recorder.start();
        source.onended=()=>setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},250);
        source.start();
        const blob=await recording;
        let binary='';for(const byte of new Uint8Array(await blob.arrayBuffer()))binary+=String.fromCharCode(byte);
        const started=performance.now();
        const response=await fetch('/api/speech/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio:btoa(binary)})});
        const transcription=await response.json();
        if(!response.ok)throw Error(JSON.stringify(transcription));
        return {source:'synthetic SAPI WAV, not microphone',durationSeconds:buffer.duration,encodedBytes:blob.size,mimeType:blob.type,recognitionMs:Math.round(performance.now()-started),transcription};
      } finally {
        if(recorder?.state==='recording')recorder.stop();
        source?.disconnect();destination.stream.getTracks().forEach(track=>track.stop());await context.close();
      }
    })()`,true);
    assert.ok(result.encodedBytes>1000);
    assert.match(result.mimeType,/webm|ogg/);
    assert.ok(result.transcription.text.trim());
    assert.equal(result.transcription.local,true);
    const report={at:new Date().toISOString(),electron:process.versions.electron,inputSha256:crypto.createHash('sha256').update(input).digest('hex'),...result};
    fs.writeFileSync(path.join(root,'.jobghost/audio-pipeline-report.json'),JSON.stringify(report,null,2));
    console.log('AUDIO_PIPELINE_OK',JSON.stringify(report));
  } catch(error) {console.error(error);process.exitCode=1;}
  finally {clearTimeout(watchdog);win?.destroy();app.exit(process.exitCode||0);}
});
