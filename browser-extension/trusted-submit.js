export async function submitWithDebugger(chromeApi,tabId){
  const target={tabId};
  let attached=false;
  try{
    await chromeApi.debugger.attach(target,'1.3');attached=true;
    await chromeApi.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
    await chromeApi.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  }catch(error){
    throw Error(`Не удалось нажать Enter во вкладке ChatGPT: ${error?.message||error}`);
  }finally{
    if(attached)try{await chromeApi.debugger.detach(target);}catch{/* Already detached by the browser. */}
  }
}
