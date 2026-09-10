// Moves only the explicitly connected chat, never unrelated browser windows.
export const HIDDEN_SERVICE_BOUNDS={left:-10000,top:-10000,width:777,height:555};
export function createBackgroundWindow(browser) {
  let owned=null;
  return async function hideOffScreen(tabId) {
    const tab=await browser.tabs.get(tabId);
    if(owned && tab.windowId===owned)await browser.windows.update(owned,{...HIDDEN_SERVICE_BOUNDS,state:'normal',focused:false});
    else {
      const created=await browser.windows.create({tabId,...HIDDEN_SERVICE_BOUNDS,focused:false,type:'normal'});
      if(!created?.id)throw Error('Браузер не создал фоновое окно ChatGPT.');
      owned=created.id;
    }
  };
}
