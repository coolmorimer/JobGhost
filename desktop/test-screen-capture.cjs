// Native Windows capture smoke test. Captures only a temporary JobGhost-owned window.
const {app,BrowserWindow,desktopCapturer}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

app.setName('JobGhost Screen Capture Test');
app.whenReady().then(async()=>{
  let sourceWindow;
  try{
    sourceWindow=new BrowserWindow({show:true,width:720,height:420,title:'JobGhost Capture Fixture',webPreferences:{sandbox:true}});
    await sourceWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>body{margin:0;background:#111827;color:#eef2ff;font:30px system-ui;display:grid;place-items:center;height:100vh}main{text-align:center}b{color:#9b8cff}</style><main><b>JOBGHOST_SCREEN_OK</b><p>Проверка захвата окна</p></main>'));
    await new Promise(resolve=>setTimeout(resolve,400));
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:720,height:420},fetchWindowIcons:false});
    const source=sources.find(item=>item.name.includes('JobGhost Capture Fixture'));
    assert.ok(source,'temporary JobGhost window must be available to desktopCapturer');
    const png=source.thumbnail.toPNG();
    assert.ok(png.length>5000,'captured window image must not be empty');
    const output=path.join(__dirname,'../.jobghost/screen-capture.png');
    fs.writeFileSync(output,png);
    fs.writeFileSync(path.join(__dirname,'../.jobghost/screen-capture-report.json'),JSON.stringify({at:new Date().toISOString(),source:source.name,bytes:png.length,output},null,2));
    console.log('SCREEN_CAPTURE_OK',JSON.stringify({source:source.name,bytes:png.length,output}));
  }catch(error){console.error(error);process.exitCode=1;}
  finally{sourceWindow?.destroy();app.exit(process.exitCode||0);}
});
