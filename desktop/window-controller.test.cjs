const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createWindowController,trustedSender}=require('./window-controller.cjs');
function fixture(maximized=false) {
  let bounds={x:100,y:100,width:1180,height:850},top=false,max=maximized,skip=false;
  const window={getBounds:()=>({...bounds}),isAlwaysOnTop:()=>top,isMaximized:()=>max,
    setBounds:b=>{bounds=b;},setAlwaysOnTop:v=>{top=v;},setMinimumSize:()=>{},
    setSkipTaskbar:v=>{skip=v;},isSkipped:()=>skip,
    maximize:()=>{max=true;},unmaximize:()=>{max=false;}};
  return {window,controller:createWindowController(window,{getDisplayMatching:()=>({workArea:{x:-1920,y:0,width:1920,height:1080}})})};
}
test('compact mode uses work area and restores original bounds/top state',()=>{
  const {window,controller}=fixture();const original=window.getBounds();
  assert.equal(controller.setCompact(true).compact,true);
  assert.deepEqual(window.getBounds(),{x:-860,y:0,width:860,height:700});
  assert.equal(window.isAlwaysOnTop(),true);
  assert.equal(window.isSkipped(),true);
  controller.setCompact(true); // Idempotent: does not overwrite the saved bounds.
  controller.setCompact(false);
  assert.deepEqual(window.getBounds(),original);assert.equal(window.isAlwaysOnTop(),false);
  assert.equal(window.isSkipped(),false);
});
test('restores maximization and rejects non-boolean IPC argument',()=>{
  const {window,controller}=fixture(true);
  assert.throws(()=>controller.setCompact('true'),TypeError);
  controller.setCompact(true);assert.equal(window.isMaximized(),false);
  controller.setCompact(false);assert.equal(window.isMaximized(),true);
});
test('compact height follows content within safe work-area limits',()=>{
  const {window,controller}=fixture();
  controller.setCompact(true);
  controller.setCompactHeight(320);
  assert.deepEqual(window.getBounds(),{x:-860,y:0,width:860,height:320});
  controller.setCompactHeight(50);
  assert.equal(window.getBounds().height,180);
  controller.setCompactHeight(5000);
  assert.equal(window.getBounds().height,700);
  assert.throws(()=>controller.setCompactHeight(Number.NaN),TypeError);
});
test('IPC only trusts own local top frame',()=>{
  const mainFrame={url:'http://127.0.0.1:8765/'};
  const window={webContents:{mainFrame}};
  const valid={sender:window.webContents,senderFrame:mainFrame};
  assert.equal(trustedSender(valid,window,'http://127.0.0.1:8765'),true);
  assert.equal(trustedSender({...valid,sender:{}},window,'http://127.0.0.1:8765'),false);
  assert.equal(trustedSender({...valid,senderFrame:{url:mainFrame.url}},window,'http://127.0.0.1:8765'),false);
  mainFrame.url='https://evil.example';
  assert.equal(trustedSender(valid,window,'http://127.0.0.1:8765'),false);
});
