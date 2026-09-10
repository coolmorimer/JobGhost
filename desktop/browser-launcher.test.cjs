const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browserCandidates,launchChatBrowser}=require('./browser-launcher.cjs');
test('prefers Google Chrome and starts only a minimized ChatGPT window',()=>{
  const env={ProgramFiles:'C:\\Apps',LOCALAPPDATA:'C:\\User'};const candidates=browserCandidates(env);const calls=[];
  const result=launchChatBrowser({env,exists:value=>value===candidates[0],spawn:(file,args,options)=>{calls.push({file,args,options});return {unref(){calls.push('unref');}};}});
  assert.equal(result,candidates[0]);assert.deepEqual(calls[0].args,['--start-minimized','--new-window','https://chatgpt.com/']);
  assert.equal(calls[0].options.windowsHide,true);assert.equal(calls[1],'unref');
});
test('does nothing when Google Chrome is absent',()=>assert.equal(launchChatBrowser({exists:()=>false,spawn:()=>assert.fail(),env:{ProgramFiles:'C:\\Apps'}}),null));
