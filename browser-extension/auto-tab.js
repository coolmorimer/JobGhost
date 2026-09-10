export async function findOrCreateChatTab(browser){
  const existing=(await browser.tabs.query({url:'https://chatgpt.com/*'})).filter(tab=>Number.isInteger(tab.id));
  if(existing.length)return existing.find(tab=>tab.active)||existing[0];
  const created=await browser.windows.create({url:'https://chatgpt.com/',state:'minimized',focused:false,type:'normal'});
  const tab=created?.tabs?.[0];
  if(!tab?.id)throw Error('Не удалось открыть ChatGPT. Откройте его один раз вручную.');
  return tab;
}
export async function waitForChatEditor({inspect,tabId,pause,attempts=40}){
  let page={ready:false,reason:'editor_unavailable'};
  for(let attempt=0;attempt<attempts;attempt++){
    try{page=await inspect(tabId,'status');}catch{page={ready:false,reason:'tab_unavailable'};}
    if(page.ready)return page;
    await pause(500);
  }
  return page;
}
