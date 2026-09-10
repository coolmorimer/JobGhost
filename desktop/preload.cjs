const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('jobghostDesktop',{
  openChat:()=>ipcRenderer.invoke('jobghost:open-chat'),
  openExtensionFolder:()=>ipcRenderer.invoke('jobghost:extension-folder'),
  hide:()=>ipcRenderer.invoke('jobghost:hide'),
  quit:()=>ipcRenderer.invoke('jobghost:quit'),
  setOverlay:options=>ipcRenderer.invoke('jobghost:overlay',options),
  setCapture:active=>ipcRenderer.invoke('jobghost:capture',active),
  getState:()=>ipcRenderer.invoke('jobghost:window-state'),
  setCompact:value=>ipcRenderer.invoke('jobghost:set-compact',value),
  setCompactHeight:value=>ipcRenderer.invoke('jobghost:set-compact-height',value),
  onAction:callback=>{
    const listener=(_event,action)=>{if(['ask','snapshot','stop'].includes(action)) callback(action);};
    ipcRenderer.on('jobghost:action',listener);
    return ()=>ipcRenderer.removeListener('jobghost:action',listener);
  },
});
