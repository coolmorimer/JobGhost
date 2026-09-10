const HIDDEN_BOUNDS={left:-10000,top:-10000,width:777,height:555};

function isServiceBounds(rect){
  if(!rect)return false;
  const width=Number(rect.right)-Number(rect.left),height=Number(rect.bottom)-Number(rect.top);
  return Number(rect.left)<=-9000&&Number(rect.top)<=-9000&&Math.abs(width-HIDDEN_BOUNDS.width)<=20&&Math.abs(height-HIDDEN_BOUNDS.height)<=20;
}
function isServiceWindow(item){return !!item&&(item.title==='JobGhost Service - Google Chrome'||isServiceBounds(item.rect));}

function windowsChromeService(){
  if(process.platform!=='win32')return {hideMarked:()=>0,hideKnown:()=>0,show:()=>0,close:()=>0,state:()=>({hidden:0})};
  const koffi=require('koffi');const user32=koffi.load('user32.dll');
  const Rect=koffi.struct('JOBGHOST_CHROME_RECT',{left:'long',top:'long',right:'long',bottom:'long'});
  const EnumProc=koffi.proto('bool __stdcall JOBGHOST_ENUM_WINDOWS(intptr_t hWnd, intptr_t lParam)');
  const enumWindows=user32.func('bool __stdcall EnumWindows(JOBGHOST_ENUM_WINDOWS *lpEnumFunc, intptr_t lParam)');
  const getRect=user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ JOBGHOST_CHROME_RECT *lpRect)');
  const getClass=user32.func('int __stdcall GetClassNameW(intptr_t hWnd, _Out_ void *lpClassName, int nMaxCount)');
  const getTitle=user32.func('int __stdcall GetWindowTextW(intptr_t hWnd, _Out_ void *lpString, int nMaxCount)');
  const showWindow=user32.func('bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)');
  const setWindowPos=user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, unsigned int uFlags)');
  const postMessage=user32.func('bool __stdcall PostMessageW(intptr_t hWnd, unsigned int Msg, uintptr_t wParam, intptr_t lParam)');
  const known=new Set();
  const enumerate=()=>{
    const found=[];
    enumWindows((handle)=>{
      const buffer=Buffer.alloc(256);getClass(handle,buffer,128);
      const className=buffer.toString('utf16le').split('\0')[0];
      if(className==='Chrome_WidgetWin_1'){
        const rect={},titleBuffer=Buffer.alloc(1024);getTitle(handle,titleBuffer,512);
        const title=titleBuffer.toString('utf16le').split('\0')[0];
        if(getRect(handle,rect))found.push({handle:Number(handle),rect,title});
      }
      return true;
    },0);
    return found;
  };
  const hideMarked=()=>{
    let count=0;
    for(const item of enumerate())if(isServiceWindow(item)){known.add(item.handle);showWindow(item.handle,0);count++;}
    return count;
  };
  const hideKnown=()=>{let count=0;for(const handle of known){showWindow(handle,0);count++;}return count;};
  const show=()=>{let count=0;for(const handle of known){setWindowPos(handle,0,80,80,1100,800,0x0040);showWindow(handle,9);count++;}return count;};
  const close=()=>{let count=0;for(const handle of known){postMessage(handle,0x0010,0,0);count++;}known.clear();return count;};
  return {hideMarked,hideKnown,show,close,state:()=>({hidden:known.size}),inspect:()=>enumerate().map(item=>item.rect)};
}

module.exports={HIDDEN_BOUNDS,isServiceBounds,isServiceWindow,windowsChromeService};
