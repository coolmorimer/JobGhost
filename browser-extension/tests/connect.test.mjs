import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from '../../frontend/node_modules/jsdom/lib/api.js';
const source=readFileSync(new URL('../connect.js',import.meta.url),'utf8');
function fixture(handler){
  const dom=new JSDOM('<input id="code"><input id="consent" type="checkbox"><button id="connect"></button><button id="disconnect"></button><p id="state"></p>',{url:'https://extension.test/connect.html?tab=42',runScripts:'outside-only'});
  const w=dom.window,calls=[];let tick;
  w.chrome={runtime:{sendMessage:async request=>{calls.push(request);return await handler(request);}}};
  w.setInterval=fn=>{tick=fn;return 1;};w.clearInterval=()=>{tick=null;};w.eval(source);
  return {dom,w,calls,tick:()=>tick?.()};
}
const connected={connected:true,connecting:false,running:false,tabId:42,message:'Подключено в фоне'};
test('closing settings does not send a disconnect command',async()=>{
  const f=fixture(async()=>({state:connected}));
  await Promise.resolve();await Promise.resolve();
  f.w.dispatchEvent(new f.w.Event('pagehide'));f.dom.window.close();
  assert.ok(f.calls.every(m=>m.type==='status'));
});
test('settings sends selected tab and explicit consent to worker',async()=>{
  const f=fixture(async()=>({state:connected}));
  f.w.document.getElementById('code').value='a'.repeat(43);f.w.document.getElementById('consent').checked=true;
  await f.w.document.getElementById('connect').onclick();
  const request=f.calls.find(m=>m.type==='connect');assert.equal(request.tabId,42);assert.equal(request.consent,true);assert.equal(request.code.length,43);
  assert.equal(f.w.document.getElementById('code').value,'');f.dom.window.close();
});
test('explicit disconnect is forwarded, page reload alone is not',async()=>{
  const f=fixture(async()=>({state:connected}));await f.w.document.getElementById('disconnect').onclick();
  assert.equal(f.calls.filter(m=>m.type==='disconnect').length,1);f.dom.window.close();
});
test('validation error survives subsequent status refresh',async()=>{
  const f=fixture(async request=>request.type==='connect'?{error:'Нужно разрешение'}:{state:{...connected,connected:false,message:'Не подключено'}});
  await f.w.document.getElementById('connect').onclick();f.tick();await Promise.resolve();await Promise.resolve();
  assert.equal(f.w.document.getElementById('state').textContent,'Нужно разрешение');f.w.dispatchEvent(new f.w.Event('pagehide'));f.dom.window.close();
});
