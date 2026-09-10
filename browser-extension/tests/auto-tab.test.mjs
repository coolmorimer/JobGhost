import test from 'node:test';
import assert from 'node:assert/strict';
import {findOrCreateChatTab,waitForChatEditor} from '../auto-tab.js';
test('reuses an existing active ChatGPT tab without opening another',async()=>{
  let creates=0;const browser={tabs:{query:async()=>[{id:2,active:false},{id:3,active:true}]},windows:{create:async()=>{creates++;}}};
  assert.equal((await findOrCreateChatTab(browser)).id,3);assert.equal(creates,0);
});
test('opens a minimized unfocused ChatGPT window when none exists',async()=>{
  let options;const browser={tabs:{query:async()=>[]},windows:{create:async value=>{options=value;return {tabs:[{id:7,windowId:9}]};}}};
  assert.equal((await findOrCreateChatTab(browser)).id,7);
  assert.deepEqual(options,{url:'https://chatgpt.com/',state:'minimized',focused:false,type:'normal'});
});
test('waits for the editor and tolerates a tab loading error',async()=>{
  let calls=0,waits=0;const result=await waitForChatEditor({tabId:7,pause:async ms=>{assert.equal(ms,500);waits++;},attempts:3,inspect:async()=>{calls++;if(calls===1)throw Error('loading');return {ready:true,reason:'connected'};}});
  assert.equal(result.ready,true);assert.equal(calls,2);assert.equal(waits,1);
});
