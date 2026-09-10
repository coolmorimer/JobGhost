const {app, BrowserWindow, desktopCapturer, dialog, globalShortcut, session, ipcMain, screen,shell} = require('electron');
const {createOverlayController,windowsShiftReader}=require('./overlay-controller.cjs');
const {createWindowController,trustedSender}=require('./window-controller.cjs');
const {registerFirst}=require('./shortcuts.cjs');
const {windowsTopmost}=require('./topmost.cjs');
const {launchChatBrowser}=require('./browser-launcher.cjs');
const {windowsChromeService}=require('./chrome-window.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const port=Number(process.env.JOBGHOST_PORT || 8765);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Некорректный порт JobGhost');
const base = `http://127.0.0.1:${port}`;
let window;
let controller, overlay, quitting=false;
let chromeService,chromeHideTimer;
let ownedServer;
let desktopLog='';
app.setName('JobGhost Background');
app.setAppUserModelId('tech.jobghost.desktop');
const showWindow=()=>{
  if(!window)return;
  window.setSkipTaskbar(controller?.state().compact ?? false);
  window.show();
  if(window.isMinimized())window.restore();
  window.focus();
};
const hideWindow=()=>{if(window){window.setSkipTaskbar(true);window.hide();}};
const backgroundSmoke=process.argv.includes('--background-smoke');
const backgroundStart=process.argv.includes('--background')||backgroundSmoke;
const extensionFolder=app.isPackaged?path.join(process.resourcesPath,'browser-extension'):path.join(__dirname,'../browser-extension');
const logDesktop=value=>{
  try{if(desktopLog)require('node:fs').appendFileSync(desktopLog,`[${new Date().toISOString()}] ${value}\n`);}catch{/* Logging must never break startup. */}
};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('before-quit',()=>{quitting=true;clearInterval(chromeHideTimer);chromeService?.close();ownedServer?.kill();});
  app.whenReady().then(async () => {
    try {
      desktopLog=path.join(app.getPath('userData'),'desktop.log');logDesktop(`start packaged=${app.isPackaged} port=${port} background=${backgroundStart}`);
      chromeService=windowsChromeService();
      chromeHideTimer=setInterval(()=>{try{const hidden=chromeService.hideMarked();if(hidden)logDesktop(`hidden Chrome service windows: ${hidden}`);}catch(error){logDesktop(`Chrome hide failed: ${error}`);}},250);
      const alive = await fetch(base + '/api/health').then(r => r.ok).catch(() => false);
      if (!alive) {
        if(app.isPackaged){
          const fs=require('node:fs');const data=path.join(app.getPath('userData'),'data');fs.mkdirSync(data,{recursive:true});
          const log=fs.openSync(path.join(data,'server.log'),'a');
          ownedServer=spawn(path.join(process.resourcesPath,'server/jobghost-server.exe'),[],{windowsHide:true,cwd:data,stdio:['ignore',log,log],env:{...process.env,JOBGHOST_USER_DATA:data,JOBGHOST_FRONTEND_DIR:path.join(process.resourcesPath,'frontend'),JOBGHOST_SPEECH_MODEL_PATH:path.join(process.resourcesPath,'speech-model')}});
          ownedServer.on('error',error=>console.error('Server start failed',error));fs.closeSync(log);
        }else{
          const child = spawn('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, '../scripts/start-background.ps1')], {windowsHide:true, detached:true, stdio:'ignore'});
          child.unref();
        }
        let ready = false;
        for (let i=0; i<160; i++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (await fetch(base + '/api/health').then(r=>r.ok).catch(()=>false)) {ready=true; break;}
        }
        if (!ready) throw new Error('Сервер JobGhost не запустился. Проверьте .jobghost/logs.');
      }
      window = new BrowserWindow({title:'JobGhost', show:false,width:1180, height:850, minWidth:650, minHeight:500, frame:false,transparent:true,backgroundColor:'#00000000',autoHideMenuBar:true, webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true, preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false}});
      window.setContentProtection(true);
      window.on('show',()=>window.setContentProtection(overlay?.state().protection ?? true));
      window.once('ready-to-show',()=>{logDesktop('renderer ready');if(!backgroundStart)window.show();});
      controller=createWindowController(window,screen,windowsTopmost(window));
      const failedShortcuts=[];
      let pointerShortcut=null,askShortcut=null;
      overlay=createOverlayController(window,windowsShiftReader());
      const state=()=>({...controller.state(),failedShortcuts,pointerShortcut,askShortcut,overlay:overlay.state(),serviceBrowser:chromeService.state()});
      const guard=event=>{if(!trustedSender(event,window,base))throw Error('Недопустимый источник команды окна');};
      ipcMain.handle('jobghost:open-chat',async event=>{
        guard(event);
        if(!chromeService.show())return shell.openExternal('https://chatgpt.com/');
        for(let attempt=0;attempt<300;attempt++){
          await new Promise(resolve=>setTimeout(resolve,1000));
          const ready=await fetch(base+'/api/chat-browser/status').then(r=>r.json()).then(v=>v.state==='ready').catch(()=>false);
          if(ready){await new Promise(resolve=>setTimeout(resolve,1500));chromeService.hideKnown();return;}
        }
      });
      ipcMain.handle('jobghost:extension-folder',async event=>{guard(event);const error=await shell.openPath(extensionFolder);if(error)throw Error(error);return extensionFolder;});
      ipcMain.handle('jobghost:hide',event=>{guard(event);hideWindow();});
      ipcMain.handle('jobghost:capture',(event,active)=>{guard(event);if(typeof active!=='boolean')throw TypeError('Ожидается состояние захвата');return state();});
      ipcMain.handle('jobghost:quit',event=>{guard(event);quitting=true;app.quit();});
      window.on('close',event=>{if(!quitting){event.preventDefault();hideWindow();}});
      ipcMain.handle('jobghost:window-state',event=>{guard(event);return state();});
      ipcMain.handle('jobghost:set-compact',(event,value)=>{guard(event);controller.setCompact(value);overlay.set({enabled:value});return state();});
      ipcMain.handle('jobghost:set-compact-height',(event,value)=>{guard(event);return controller.setCompactHeight(value);});
      ipcMain.handle('jobghost:overlay',(event,options)=>{guard(event);if(options && 'enabled' in options)throw Error('Используйте переключение режима');return overlay.set(options);});
      window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){controller.setCompact(false);overlay.set({enabled:false});}});
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && new URL(contents.getURL()).origin === base && ['media', 'display-capture'].includes(permission)));
      session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
          if (new URL(request.frame.url).origin !== base) return callback({});
          const sources = await desktopCapturer.getSources({types:['screen','window']});
          const choice = await dialog.showMessageBox(window, {type:'question', title:'Захват экрана', message:'Выберите экран или окно для JobGhost', detail:'При запросе звука будет доступен системный звук всего компьютера. Используйте только с согласия участников разговора.', buttons:['Отмена', ...sources.map(s=>s.name)], defaultId:0, cancelId:0, noLink:true});
          if (!choice.response) return callback({});
          callback({video:sources[choice.response-1], ...(request.audioRequested ? {audio:'loopback'} : {})});
        } catch {callback({});}
      });
      window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      window.webContents.on('will-navigate', (event, url) => {if (new URL(url).origin !== base) event.preventDefault();});
      await window.loadURL(base);
      logDesktop('interface loaded');
      if(backgroundSmoke){
        if(window.isVisible())throw Error('Фоновый запуск показал окно');
        logDesktop('BACKGROUND_SMOKE_OK window remained hidden');
        app.quit();return;
      }
      if(app.isPackaged&&!process.argv.includes('--smoke'))void (async()=>{
        for(let attempt=0;attempt<20;attempt++){
          await new Promise(resolve=>setTimeout(resolve,500));
          const ready=await fetch(base+'/api/chat-browser/status').then(r=>r.json()).then(v=>v.state==='ready').catch(()=>false);
          if(ready){logDesktop('ChatGPT extension connected automatically');return;}
        }
        const executable=launchChatBrowser({exists:require('node:fs').existsSync,spawn});
        logDesktop(executable?`started browser for automatic ChatGPT connection: ${executable}`:'Google Chrome was not found for automatic start');
      })();
      if (process.argv.includes('--smoke')) {
        const fs = require('node:fs');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const screenshot = await window.webContents.capturePage();
        const output = path.join(__dirname, '../.jobghost/desktop-smoke.png');
        fs.mkdirSync(path.dirname(output), {recursive:true});
        fs.writeFileSync(output, screenshot.toPNG());
        logDesktop(`DESKTOP_SMOKE_OK ${output}`);console.log('DESKTOP_SMOKE_OK', output);
        app.quit(); return;
      }
      const register=(key,action)=>{if(!globalShortcut.register(key,action))failedShortcuts.push(key);};
      register('Control+Shift+Space', () => {if(window.isVisible() && !window.isMinimized())hideWindow();else showWindow();});
      register('Control+Shift+T', () => window.setAlwaysOnTop(!window.isAlwaysOnTop()));
      askShortcut=registerFirst(globalShortcut,['Control+Enter','Control+Alt+Enter'],()=>window.webContents.send('jobghost:action','ask'));
      if(!askShortcut)failedShortcuts.push('Control+Enter / Control+Alt+Enter');
      register('Control+Alt+S',()=>window.webContents.send('jobghost:action','snapshot'));
      register('Control+Alt+X',()=>window.webContents.send('jobghost:action','stop'));
      pointerShortcut=registerFirst(globalShortcut,['Control+Alt+M','Control+Shift+Alt+M'],()=>overlay.set({passthrough:!overlay.state().passthrough}));
      if(!pointerShortcut)failedShortcuts.push('Control+Alt+M / Control+Shift+Alt+M');
    } catch (error) {logDesktop(error?.stack||String(error));dialog.showErrorBox('JobGhost', String(error)); app.quit();}
  });
  app.on('will-quit', () => {globalShortcut.unregisterAll();overlay?.dispose();});
  app.on('window-all-closed', () => app.quit());
}
