function createOverlayController(window,isShiftDown) {
  let enabled=false, opacity=0.85, passthrough=true, protection=true, ignoring=false, timer=null;
  const state=()=>({enabled,opacity,passthrough,protection,ignoring,protected:window.isContentProtected()});
  const pointer=()=>{
    const next=enabled && passthrough && !isShiftDown();
    if(next!==ignoring){window.setIgnoreMouseEvents(next,{forward:true});window.setFocusable(!next);ignoring=next;}
  };
  const set=options=>{
    if(!options || typeof options!=='object')throw TypeError('Некорректные настройки окна');
    for(const key of Object.keys(options))if(!['enabled','opacity','passthrough','protection'].includes(key))throw TypeError('Неизвестная настройка');
    for(const key of ['enabled','passthrough','protection'])if(key in options && typeof options[key]!=='boolean')throw TypeError('Ожидается переключатель');
    if('opacity' in options && (typeof options.opacity!=='number' || !Number.isFinite(options.opacity) || options.opacity<0.25 || options.opacity>1))throw TypeError('Непрозрачность: от 25 до 100%');
    if('enabled' in options)enabled=options.enabled;
    if('opacity' in options)opacity=options.opacity;
    if('passthrough' in options)passthrough=options.passthrough;
    if('protection' in options)protection=options.protection;
    clearInterval(timer);timer=null;
    window.setOpacity(enabled?opacity:1);
    pointer();
    window.setContentProtection(protection);
    if(enabled && passthrough)timer=setInterval(()=>{
      try{pointer();}catch{clearInterval(timer);timer=null;window.setIgnoreMouseEvents(false);window.setFocusable(true);ignoring=false;passthrough=false;}
    },25);
    return state();
  };
  return {state,set,tick:pointer,dispose:()=>{clearInterval(timer);timer=null;}};
}
function windowsShiftReader(){
  if(process.platform!=='win32')throw Error('Управление через Shift доступно только в Windows');
  const koffi=require('koffi');
  const user32=koffi.load('user32.dll');
  const read=user32.func('short __stdcall GetAsyncKeyState(int vKey)');
  // Only the Shift key's current high bit. No other keys, history, or logging.
  return ()=>!!(read(0x10)&0x8000);
}
module.exports={createOverlayController,windowsShiftReader};
