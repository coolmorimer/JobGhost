function registerFirst(shortcuts,candidates,action){
  for(const key of candidates)if(shortcuts.register(key,action))return key;
  return null;
}
module.exports={registerFirst};
