import test from 'node:test';
import assert from 'node:assert/strict';
import {submitWithDebugger} from '../trusted-submit.js';

test('sends one trusted Enter and always detaches',async()=>{
  const calls=[];
  const api={debugger:{
    attach:async(target,version)=>calls.push(['attach',target,version]),
    sendCommand:async(target,method,payload)=>calls.push(['send',target,method,payload.type]),
    detach:async target=>calls.push(['detach',target]),
  }};
  await submitWithDebugger(api,42);
  assert.deepEqual(calls,[
    ['attach',{tabId:42},'1.3'],
    ['send',{tabId:42},'Input.dispatchKeyEvent','rawKeyDown'],
    ['send',{tabId:42},'Input.dispatchKeyEvent','keyUp'],
    ['detach',{tabId:42}],
  ]);
});

test('reports send failure and detaches after attach',async()=>{
  let detached=false;
  const api={debugger:{attach:async()=>{},sendCommand:async()=>{throw Error('blocked');},detach:async()=>{detached=true;}}};
  await assert.rejects(submitWithDebugger(api,5),/не удалось нажать Enter/i);
  assert.equal(detached,true);
});
