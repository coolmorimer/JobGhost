const el=id=>document.getElementById(id);
const tabId=Number(new URLSearchParams(location.search).get('tab'));
let submitting=false,localError='',active=true,minimizeWhenReady=false,minimizing=false;
async function send(request){
  const result=await chrome.runtime.sendMessage(request);
  if(result?.error)throw Error(result.error);
  if(!result?.state)throw Error('Нет связи с фоновым расширением. Перезагрузите расширение в Edge.');
  return result.state;
}
function render(state){
  if(!active)return;
  el('state').textContent=localError||state.message;
  el('connect').disabled=submitting||state.connected||state.connecting||state.running;
  el('disconnect').disabled=!(state.connected||state.connecting);
  if(el('background'))el('background').disabled=!state.connected||minimizing;
  if(state.connected)el('code').value='';
}
async function minimizeIfReady(state){if(state.connected&&minimizeWhenReady&&!minimizing){minimizeWhenReady=false;await minimize();}}
async function minimize(){
  minimizing=true;
  try{const state=await send({type:'background'});localError='';render(state);}
  catch(error){localError=error.message;if(active)el('state').textContent=localError;}
  finally{minimizing=false;if(active&&el('background'))el('background').disabled=false;}
}
if(el('background'))el('background').onclick=()=>{localError='';void minimize();};
if(el('auto'))el('auto').onclick=async()=>{localError='';submitting=true;try{const state=await send({type:'auto'});render(state);}catch(error){localError=error.message;el('state').textContent=localError;}finally{submitting=false;}};
async function refresh(){
  try{const state=await send({type:'status'});render(state);await minimizeIfReady(state);}
  catch(error){if(active)el('state').textContent=error.message;}
}
el('connect').onclick=async()=>{
  if(submitting)return;
  submitting=true;localError='';el('connect').disabled=true;
  try{
    const state=await send({type:'connect',tabId,code:el('code').value.trim(),consent:el('consent').checked});
    el('code').value='';submitting=false;minimizeWhenReady=true;render(state);await minimizeIfReady(state);
  }catch(error){submitting=false;localError=error.message;el('connect').disabled=false;el('state').textContent=localError;}
};
el('disconnect').onclick=async()=>{localError='';try{render(await send({type:'disconnect'}));}catch(error){localError=error.message;el('state').textContent=localError;}};
// Closing this document only removes its status viewer; the worker owns the socket.
const statusTimer=setInterval(()=>{if(!submitting)void refresh();},1000);
window.addEventListener('pagehide',()=>{active=false;clearInterval(statusTimer);},{once:true});
void refresh();
