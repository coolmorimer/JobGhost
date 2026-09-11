// Isolated development harness. Does not close or change the user's app window.
const {app,BrowserWindow,ipcMain,screen}=require('electron');
const {createOverlayController,windowsShiftReader}=require('./overlay-controller.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createWindowController,trustedSender}=require('./window-controller.cjs');
const {windowsTopmost}=require('./topmost.cjs');
const base='http://127.0.0.1:8765';
app.setName('JobGhost Native Test');
app.whenReady().then(async()=>{
  let win;
  let overlay;
  try {
    win=new BrowserWindow({show:true,width:1180,height:850,minWidth:650,minHeight:500,frame:false,transparent:true,backgroundColor:'#00000000',
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'jobghost-native-test'}});
    const nativeTopmost=windowsTopmost(win);
    const controller=createWindowController(win,screen,nativeTopmost);
    assert.equal(typeof windowsShiftReader()(),'boolean');
    let shift=false;
    overlay=createOverlayController(win,()=>shift);
    const hide=()=>{win.setSkipTaskbar(true);win.hide();};
    const show=()=>{win.setSkipTaskbar(controller.state().compact);win.show();win.focus();};
    ipcMain.handle('jobghost:hide',hide);
    ipcMain.handle('jobghost:quit',()=>{});
    ipcMain.handle('jobghost:capture',(_event,active)=>{assert.equal(typeof active,'boolean');});
    ipcMain.handle('jobghost:capture-region',()=>null);
    ipcMain.handle('jobghost:window-state',event=>{
      assert.equal(trustedSender(event,win,base),true);return {...controller.state(),failedShortcuts:[],pointerShortcut:'Control+Alt+M',overlay:overlay.state()};
    });
    ipcMain.handle('jobghost:set-compact',(event,value)=>{
      assert.equal(trustedSender(event,win,base),true);return controller.setCompact(value);
    });
    ipcMain.handle('jobghost:set-compact-height',(event,value)=>{
      assert.equal(trustedSender(event,win,base),true);return controller.setCompactHeight(value);
    });
    ipcMain.handle('jobghost:set-compact-size',(event,width,height)=>{
      assert.equal(trustedSender(event,win,base),true);return controller.setCompactSize(width,height);
    });
    await win.loadURL(base);
    const before=win.getBounds(), identity=win.webContents.id;
    assert.equal(await win.webContents.executeJavaScript('typeof require'),'undefined');
    const enteredCompact=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent?.includes('Скрытый чат поверх окон'));button?.click();return !!button;})()`);
    assert.equal(enteredCompact,true);
    for(let i=0;i<20&&!controller.state().compact;i++)await new Promise(resolve=>setTimeout(resolve,50));
    const compact=controller.state();
    assert.equal(compact.compact,true);assert.equal(controller.state().alwaysOnTop,true);assert.equal(nativeTopmost.get(),true);
    assert.equal(win.getBounds().width,860);
    for(let i=0;i<20&&!await win.webContents.executeJavaScript("!!document.querySelector('.answer-compact')");i++)await new Promise(resolve=>setTimeout(resolve,50));
    for(let i=0;i<20&&win.getBounds().height===700;i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.ok(win.getBounds().height>=180&&win.getBounds().height<700,'short empty chat must shrink the native overlay');
    await win.webContents.executeJavaScript(`(()=>{const item=document.createElement('div');item.id='native-long-answer';item.style.cssText='height:850px;flex:0 0 850px';document.querySelector('.answer-compact').append(item);})()`);
    for(let i=0;i<30&&win.getBounds().height<=700;i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.ok(win.getBounds().height>700,'long answer must grow beyond the former 700px cap');
    assert.ok(win.getBounds().height<=screen.getDisplayMatching(win.getBounds()).workArea.height,'overlay must stay inside work area');
    const layout=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.answer-compact').getBoundingClientRect();const input=document.querySelector('.question-input').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,inputTop:input.top,inputBottom:input.bottom};})()`);
    assert.equal(layout.top,0,'overlay must not inherit the hidden main header offset');
    assert.ok(layout.bottom<=layout.height+1,'overlay bottom must be inside the native window');
    assert.ok(layout.inputTop>=0&&layout.inputBottom<layout.height,'voice composer must stay visible');
    await win.webContents.executeJavaScript("document.querySelector('#native-long-answer')?.remove()");
    require('node:fs').writeFileSync(path.join(__dirname,'../.jobghost/compact-adaptive.png'),(await win.webContents.capturePage()).toPNG());
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.answer-compact')).userSelect"),'none');
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.answer-compact')).overflow"),'hidden');
    overlay.set({enabled:true,opacity:0.8,passthrough:true});
    console.log('OVERLAY_NATIVE_STATE',JSON.stringify({protected:win.isContentProtected(),opacity:win.getOpacity(),state:overlay.state()}));
    assert.equal(win.isContentProtected(),true);assert.ok(Math.abs(win.getOpacity()-0.8)<0.02);
    assert.equal(overlay.state().ignoring,true);
    shift=true;overlay.tick();assert.equal(overlay.state().ignoring,false);
    shift=false;overlay.tick();assert.equal(overlay.state().ignoring,true);
    overlay.set({protection:false});assert.equal(win.isContentProtected(),false);
    overlay.set({protection:true});assert.equal(win.isContentProtected(),true);
    overlay.set({enabled:false});assert.equal(win.isContentProtected(),true);assert.equal(win.getOpacity(),1);
    assert.equal(win.webContents.id,identity);
    await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.getAttribute('aria-label')==='Настройки чата');button?.click();return !!button;})()`);
    await new Promise(resolve=>setTimeout(resolve,100));
    const leftCompact=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent?.includes('Вернуться в большое окно'));button?.click();return !!button;})()`);
    assert.equal(leftCompact,true);
    for(let i=0;i<20&&controller.state().compact;i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.deepEqual(win.getBounds(),before);assert.equal(win.isAlwaysOnTop(),false);
    await win.webContents.executeJavaScript("window.testAction=''; window.unsubscribeTest=window.jobghostDesktop.onAction(action=>{window.testAction=action;}); true");
    win.webContents.send('jobghost:action','snapshot');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await win.webContents.executeJavaScript('window.testAction'),'snapshot');
    await win.webContents.executeJavaScript("window.unsubscribeTest(); window.testAction=''");
    win.webContents.send('jobghost:action','ask');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await win.webContents.executeJavaScript('window.testAction'),'');
    await win.webContents.executeJavaScript('window.jobghostDesktop.hide()');
    assert.equal(win.isVisible(),false);assert.equal(win.isDestroyed(),false);
    await win.webContents.executeJavaScript('window.backgroundTicks=0;window.backgroundTestTimer=setInterval(()=>window.backgroundTicks++,50);true');
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.ok(await win.webContents.executeJavaScript('window.backgroundTicks>=2'),'renderer must keep processing while hidden');
    await win.webContents.executeJavaScript('clearInterval(window.backgroundTestTimer)');
    show();
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(win.isVisible(),true);
    const fs=require('node:fs');
    fs.writeFileSync(path.join(__dirname,'../.jobghost/russian-ui.png'),(await win.webContents.capturePage()).toPNG());
    const openedSettings=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.getAttribute('aria-label')==='Настройки чата');button?.click();return !!button;})()`);
    assert.equal(openedSettings,true);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await win.webContents.executeJavaScript(`[...document.querySelectorAll('h3')].some(item=>item.textContent==='Основные')`),true);
    fs.writeFileSync(path.join(__dirname,'../.jobghost/settings-ui.png'),(await win.webContents.capturePage()).toPNG());
    console.log('NATIVE_DESKTOP_TEST_OK: real compact/restore, preload IPC, sandbox, action subscription cleanup');
  } catch(error) {console.error(error);process.exitCode=1;}
  finally {
    overlay?.dispose();
    ipcMain.removeHandler('jobghost:capture-region');
    for (const channel of ['jobghost:hide','jobghost:quit','jobghost:capture','jobghost:window-state','jobghost:set-compact','jobghost:set-compact-height','jobghost:set-compact-size']) {
      ipcMain.removeHandler(channel);
    }
    win?.destroy();
    app.exit(process.exitCode || 0);
  }
});
