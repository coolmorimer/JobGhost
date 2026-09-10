function windowsTopmost(window) {
  if(process.platform!=='win32')return null;
  const koffi=require('koffi');
  const user32=koffi.load('user32.dll');
  const setWindowPos=user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, unsigned int uFlags)');
  const getWindowLong=user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)');
  const handle=()=>{
    const value=window.getNativeWindowHandle();
    return value.length===8?Number(value.readBigUInt64LE()):value.readUInt32LE();
  };
  const get=()=>!!(Number(getWindowLong(handle(),-20))&0x8); // GWL_EXSTYLE / WS_EX_TOPMOST
  const set=value=>{
    if(typeof value!=='boolean')throw TypeError('topmost must be boolean');
    // HWND_TOPMOST / HWND_NOTOPMOST. Do not resize, move or activate another app.
    if(!setWindowPos(handle(),value?-1:-2,0,0,0,0,0x613))throw Error('Windows не включил режим поверх окон');
    return get();
  };
  return {get,set};
}
module.exports={windowsTopmost};
