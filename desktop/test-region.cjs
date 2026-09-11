// Real region UI and crop, with only a JobGhost fixture image as capture input.
const {app,BrowserWindow,desktopCapturer,screen,nativeImage}=require('electron');
const assert=require('node:assert/strict');
const {captureRegion,cropBounds}=require('./region-capture.cjs');
app.setName('JobGhost Region Test');
app.whenReady().then(async()=>{
  let owner;
  const original=desktopCapturer.getSources;
  const timeout=setTimeout(()=>app.exit(1),15000);
  try{
    owner=new BrowserWindow({show:true,width:720,height:420,title:'JobGhost Region Fixture',webPreferences:{sandbox:true}});
    await owner.loadURL('data:text/html,<body style="background:navy;color:white;font:40px Arial">JOBGHOST REGION FIXTURE</body>');
    await new Promise(resolve=>setTimeout(resolve,600));
    const fixture=nativeImage.createFromPath(require('node:path').join(__dirname,'../.jobghost/screen-capture.png'));
    assert.ok(!fixture.isEmpty(),'run test-screen-capture.cjs to create the JobGhost fixture');
    desktopCapturer.getSources=async()=>[{display_id:String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id),thumbnail:fixture}];
    const result=captureRegion(owner);
    let picker;
    for(let i=0;i<100;i++){
      picker=BrowserWindow.getAllWindows().find(w=>w!==owner&&w.isVisible());
      if(picker)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(picker,'region selection must open directly');
    await picker.webContents.executeJavaScript(`(async()=>{const image=document.getElementById('image');if(!image.complete)await new Promise(resolve=>image.onload=resolve);return true;})()`);
    picker.webContents.sendInputEvent({type:'mouseDown',x:80,y:80,button:'left',clickCount:1});
    picker.webContents.sendInputEvent({type:'mouseMove',x:420,y:300,button:'left'});
    picker.webContents.sendInputEvent({type:'mouseUp',x:420,y:300,button:'left',clickCount:1});
    const image=await result;
    assert.ok(image.startsWith('data:image/jpeg;base64,'));
    assert.ok(owner.isVisible(),'owner must be restored');
    assert.throws(()=>cropBounds({x:0,y:0,width:0,height:0},720,420));
    console.log('REGION_CAPTURE_OK fixture only; direct drag/crop/restore');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{clearTimeout(timeout);desktopCapturer.getSources=original;owner?.destroy();app.exit(process.exitCode||0);}
});
