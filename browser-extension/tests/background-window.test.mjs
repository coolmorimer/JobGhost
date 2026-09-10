import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundWindow,HIDDEN_SERVICE_BOUNDS} from '../background-window.js';
test('only the selected chat moves into a uniquely marked off-screen window',async()=>{
  let windowId=11;const calls=[];
  const browser={tabs:{get:async id=>{assert.equal(id,42);return {id,windowId};}},windows:{create:async options=>{calls.push(options);windowId=99;return {id:99};},update:async(id,options)=>{calls.push({id,...options});}}};
  const minimize=createBackgroundWindow(browser);await minimize(42);await minimize(42);
  assert.deepEqual(calls,[{tabId:42,...HIDDEN_SERVICE_BOUNDS,focused:false,type:'normal'},{id:99,...HIDDEN_SERVICE_BOUNDS,state:'normal',focused:false}]);
});
test('moving the chat out of its owned window never minimizes unrelated tabs',async()=>{
  let windowId=11,creates=0;
  const minimize=createBackgroundWindow({tabs:{get:async()=>({windowId})},windows:{create:async()=>{creates++;return {id:99};},update:async()=>assert.fail('must not minimize shared window')}});
  await minimize(42);windowId=12;await minimize(42);assert.equal(creates,2);
});
