import {chatPage} from './page.js';
import {createBridgeClient} from './bridge-client.js';
import {createBackgroundWindow} from './background-window.js';
import {findOrCreateChatTab,waitForChatEditor} from './auto-tab.js';
import {submitWithDebugger} from './trusted-submit.js';
const minimizeChat=createBackgroundWindow(chrome);
const unsupportedEdge=/Edg\//.test(globalThis.navigator?.userAgent||'');
const inspect=async(tabId,operation,payload={})=>{
  const results=await chrome.scripting.executeScript({target:{tabId},func:chatPage,args:[operation,payload,true]});
  if(results[0]?.error)throw Error(results[0].error.message||'Ошибка вкладки');
  if(!results[0]?.result)throw Error('Вкладка не вернула результат');
  if(results[0].result.error)throw Error(results[0].result.error);
  return results[0].result;
};
const bridge=createBridgeClient({inspect,submit:tabId=>submitWithDebugger(chrome,tabId),onDisconnected:()=>void autoConnect()});
const grantedTabs=new Set();
let autoRunning=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function closeReloadHelper(){
  try{
    const tabs=await chrome.tabs.query({url:chrome.runtime.getURL('reload.html')});
    await Promise.all(tabs.filter(tab=>Number.isInteger(tab.id)).map(tab=>chrome.tabs.remove(tab.id)));
  }catch{/* Reload helper cleanup must not block the bridge. */}
}

async function autoConnect(){
  const current=bridge.state();
  if(unsupportedEdge){
    await chrome.action.setBadgeText({text:'×'});await chrome.action.setBadgeBackgroundColor({color:'#6b7280'});
    return {...current,message:'JobGhost настроен на Google Chrome. Откройте расширение в Chrome.'};
  }
  if(autoRunning||current.connected||current.connecting||current.running)return current;
  autoRunning=true;
  try{
    const tab=await findOrCreateChatTab(chrome);grantedTabs.add(tab.id);
    const page=await waitForChatEditor({inspect,tabId:tab.id,pause});
    if(!page.ready){
      if(Number.isInteger(tab.windowId))await chrome.windows.update(tab.windowId,{state:'normal',focused:true,left:80,top:80,width:1100,height:800});
      await chrome.action.setBadgeText({text:'!'});await chrome.action.setBadgeBackgroundColor({color:'#d97706'});
      return bridge.state();
    }
    const response=await fetch('http://127.0.0.1:8765/api/extension/auto-ticket',{method:'POST'});
    if(!response.ok)throw Error('JobGhost ещё не запущен');
    const ticket=await response.json();
    if(ticket.state==='connected')return bridge.state();
    if(typeof ticket.code!=='string')throw Error('JobGhost не выдал допуск расширению');
    await bridge.connect({tabId:tab.id,code:ticket.code,consent:true});
    for(let attempt=0;attempt<48&&!bridge.state().connected;attempt++)await pause(250);
    if(!bridge.state().connected)throw Error('Подключение к JobGhost не подтвердилось');
    await minimizeChat(tab.id);await chrome.action.setBadgeText({text:''});
    return bridge.state();
  }catch(error){return {...bridge.state(),message:error.message||'Автоподключение пока недоступно'};}
  finally{autoRunning=false;}
}
chrome.alarms.create('jobghost-auto',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='jobghost-auto')void autoConnect();});
const start=async()=>{await closeReloadHelper();return autoConnect();};
chrome.runtime.onStartup.addListener(()=>void start());
chrome.runtime.onInstalled.addListener(()=>void start());
void start();
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !tab.url?.startsWith('https://chatgpt.com/')) {
    await chrome.tabs.create({url:chrome.runtime.getURL('connect.html')});void autoConnect();
    return;
  }
  grantedTabs.add(tab.id);
  await chrome.tabs.create({url:chrome.runtime.getURL(`connect.html?tab=${tab.id}`)});
});
chrome.tabs.onRemoved.addListener(tabId=>{
  grantedTabs.delete(tabId);
  if(bridge.state().tabId===tabId)bridge.disconnect('Выбранная вкладка ChatGPT закрыта. Откройте её и подключитесь заново.');
});
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  // Only our settings document, never a content script or website.
  let trusted=false;
  try{const source=new URL(sender.url);trusted=sender.id===chrome.runtime.id&&source.href.split('?')[0]===chrome.runtime.getURL('connect.html');}catch{ /* No document origin. */ }
  if(!trusted)return false;
  Promise.resolve().then(async()=>{
    if(request?.type==='status')return bridge.state();
    if(request?.type==='auto')return await autoConnect();
    if(request?.type==='background'){
      const current=bridge.state();
      if(!current.connected || !grantedTabs.has(current.tabId))throw Error('Сначала подключите ChatGPT.');
      await minimizeChat(current.tabId);
      return {...bridge.state(),message:'ChatGPT работает в свёрнутом окне. Вернитесь в JobGhost; эту страницу можно закрыть.'};
    }
    if(request?.type==='disconnect')return bridge.disconnect();
    if(request?.type==='connect'){
      if(!grantedTabs.has(request.tabId))throw Error('Нажмите значок JobGhost именно на вкладке ChatGPT, затем подключитесь.');
      return await bridge.connect(request);
    }
    throw Error('Неизвестная команда расширения');
  }).then(state=>respond({state}),error=>respond({error:error.message}));
  return true;
});
