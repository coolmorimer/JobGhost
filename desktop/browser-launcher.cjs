const path=require('node:path');
function browserCandidates(env=process.env){
  return [
    env.ProgramFiles&&path.join(env.ProgramFiles,'Google/Chrome/Application/chrome.exe'),
    env['ProgramFiles(x86)']&&path.join(env['ProgramFiles(x86)'],'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
}
function launchChatBrowser({exists,spawn,env=process.env}){
  const executable=browserCandidates(env).find(exists);
  if(!executable)return null;
  const child=spawn(executable,['--start-minimized','--new-window','https://chatgpt.com/'],{detached:true,windowsHide:true,stdio:'ignore'});
  child.unref();return executable;
}
module.exports={browserCandidates,launchChatBrowser};
