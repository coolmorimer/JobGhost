const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerFirst}=require('./shortcuts.cjs');
test('occupied shortcut selects fallback without touching existing registrations',()=>{
  const calls=[],action=()=>{};
  const shortcuts={register:(key,handler)=>{calls.push(key);assert.equal(handler,action);return key==='fallback';}};
  assert.equal(registerFirst(shortcuts,['primary','fallback','unused'],action),'fallback');
  assert.deepEqual(calls,['primary','fallback']);
});
test('no available shortcut is reported explicitly',()=>{
  assert.equal(registerFirst({register:()=>false},['first','second'],()=>{}),null);
});
