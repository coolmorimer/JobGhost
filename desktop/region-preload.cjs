const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('regionCapture',{
  image:()=>ipcRenderer.invoke('jobghost:region-image'),
  select:value=>ipcRenderer.invoke('jobghost:region-select',value),
});
