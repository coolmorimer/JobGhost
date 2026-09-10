const {test}=require('node:test');const assert=require('node:assert/strict');
const {HIDDEN_BOUNDS,isServiceBounds,isServiceWindow}=require('./chrome-window.cjs');
test('only the unique off-screen Chrome service bounds are eligible for native hiding',()=>{
  const marked={left:HIDDEN_BOUNDS.left,top:HIDDEN_BOUNDS.top,right:HIDDEN_BOUNDS.left+HIDDEN_BOUNDS.width,bottom:HIDDEN_BOUNDS.top+HIDDEN_BOUNDS.height};
  assert.equal(isServiceBounds(marked),true);
  assert.equal(isServiceBounds({...marked,left:0,right:HIDDEN_BOUNDS.width}),false);
  assert.equal(isServiceBounds({...marked,right:marked.right+200}),false);
  assert.equal(isServiceWindow({title:'JobGhost Service - Google Chrome',rect:{left:0,top:0,right:1000,bottom:800}}),true);
  assert.equal(isServiceWindow({title:'Личная вкладка - Google Chrome',rect:{left:0,top:0,right:1000,bottom:800}}),false);
});
