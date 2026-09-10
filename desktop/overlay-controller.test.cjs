const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOverlayController}=require('./overlay-controller.cjs');
test('protected overlay releases mouse only while Shift is held and restores on exit',()=>{
  let shift=false,protectedValue=false,opacity=1,ignored=false,focusable=true;
  const win={setContentProtection:v=>{protectedValue=v;},isContentProtected:()=>protectedValue,setOpacity:v=>{opacity=v;},setIgnoreMouseEvents:v=>{ignored=v;},setFocusable:v=>{focusable=v;}};
  const controller=createOverlayController(win,()=>shift);
  try{
    controller.set({enabled:true});assert.equal(protectedValue,true);assert.equal(opacity,0.85);assert.equal(ignored,true);assert.equal(focusable,false);
    shift=true;controller.tick();assert.equal(ignored,false);assert.equal(focusable,true);
    shift=false;controller.tick();assert.equal(ignored,true);
    controller.set({passthrough:false,opacity:0.5});assert.equal(ignored,false);assert.equal(opacity,0.5);
    controller.set({protection:false});assert.equal(protectedValue,false);assert.equal(controller.state().protection,false);
    assert.throws(()=>controller.set({opacity:0}),TypeError);assert.throws(()=>controller.set({opacity:NaN}),TypeError);
    assert.throws(()=>controller.set({passthrough:'true'}),TypeError);
    controller.set({enabled:false});assert.equal(protectedValue,false);assert.equal(opacity,1);assert.equal(ignored,false);
  }finally{controller.dispose();}
});
