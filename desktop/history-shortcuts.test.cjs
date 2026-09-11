const {test}=require('node:test');
const assert=require('node:assert/strict');
const {historyShortcuts}=require('./history-shortcuts.cjs');
test('history shortcuts register once and release when overlay is hidden',()=>{
  const handlers=new Map(),sent=[];
  const sync=historyShortcuts({register:(key,fn)=>{assert.ok(!handlers.has(key));handlers.set(key,fn);return true;},unregister:key=>handlers.delete(key)},action=>sent.push(action));
  sync(true);sync(true);
  handlers.get('Control+Left')();handlers.get('Control+Right')();
  assert.deepEqual(sent,['previous-answer','next-answer']);
  sync(false);assert.equal(handlers.size,0);
});
