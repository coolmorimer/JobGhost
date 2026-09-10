// The service worker owns this connection, not the settings tab.
export function createBridgeClient({inspect,submit,onDisconnected=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),Socket=WebSocket,timers=globalThis}) {
  let socket=null,interval=null,handshake=null,authenticated=false,connecting=false,running=false,tabId=null,generation=0;
  let message='Не подключено. Откройте ChatGPT и нажмите значок JobGhost.';
  const state=()=>({connected:authenticated && socket?.readyState===1,connecting,running,tabId,message});
  function disconnect(reason='Отключено. Уже отправленный вопрос может продолжать обрабатываться в ChatGPT.') {
    generation++;authenticated=false;connecting=false;
    timers.clearInterval(interval);interval=null;timers.clearTimeout(handshake);handshake=null;
    const old=socket;socket=null;old?.close();message=reason;
    return state();
  }
  async function connect({tabId:selected,code,consent}) {
    if(socket || connecting || running)throw Error('Подключение или запрос уже активен. Сначала отключите текущее соединение.');
    if(!Number.isInteger(selected)||selected<=0)throw Error('Выберите вкладку ChatGPT через значок расширения.');
    if(consent!==true)throw Error('Нужно ваше разрешение на передачу вопросов и выбранных снимков.');
    if(typeof code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code))throw Error('Вставьте новый одноразовый код из JobGhost.');
    const attempt=++generation;connecting=true;tabId=selected;message='Проверяем выбранную вкладку…';
    try {
      if(!(await inspect(selected,'status')).ready)throw Error('Сначала войдите в ChatGPT вручную и откройте чат.');
      if(attempt!==generation)return state();
      const ws=new Socket('ws://127.0.0.1:8765/api/extension/connect');socket=ws;
      message='Проверяем код и подключение…';
      const seen=new Set();let checking=false;
      const beat=async()=>{
        if(checking||socket!==ws||ws.readyState!==1||!authenticated)return;
        checking=true;let current;
        try{current=await inspect(selected,'status');}catch{current={ready:false,reason:'tab_unavailable'};}
        finally{checking=false;}
        if(socket===ws&&ws.readyState===1){
          ws.send(JSON.stringify({type:'heartbeat',ready:current.ready,reason:current.reason}));
          if(!current.ready)message=current.reason==='tab_unavailable'?'Нет доступа к вкладке ChatGPT. Откройте её и подключитесь заново.':'Поле ChatGPT недоступно. Проверьте вход в выбранной вкладке.';
        }
      };
      handshake=timers.setTimeout(()=>{if(socket===ws)disconnect('Сервер не подтвердил подключение. Проверьте запуск JobGhost и получите новый код.');},12000);
      ws.onopen=()=>{if(socket===ws)ws.send(JSON.stringify({code}));code='';};
      const reconnect=()=>timers.setTimeout(()=>onDisconnected(),1000);
      ws.onerror=()=>{if(socket===ws){disconnect('Нет связи с сервером JobGhost. Переподключаемся автоматически.');reconnect();}};
      ws.onclose=event=>{if(socket===ws){disconnect(event.code===1008?'Код неверный, истёк или уже использован. Получаем новый допуск автоматически.':'Связь с JobGhost закрыта. Переподключаемся автоматически; уже отправленные вопросы не повторяются.');reconnect();}};
      ws.onmessage=async event=>{
        if(socket!==ws)return;
        let data;try{data=JSON.parse(event.data);}catch{disconnect('Некорректное сообщение сервера. Соединение закрыто.');return;}
        if(!data||typeof data!=='object')return;
        if(data.type==='connected'&&!authenticated){
          timers.clearTimeout(handshake);handshake=null;authenticated=true;connecting=false;
          message='Подключено в фоне. Эту страницу можно закрыть. Вкладку ChatGPT оставьте открытой.';
          // Chromium 116+: WebSocket traffic within 30s keeps the worker alive.
          interval=timers.setInterval(()=>{
            if(socket===ws&&ws.readyState===1){ws.send(JSON.stringify({type:'keepalive'}));void beat();}
          },10000);
          await beat();
        }else if(data.type==='ping'){await beat();}
        else if(data.type==='diagnostic'&&authenticated){
          if(typeof data.id!=='string'||!data.id||data.id.length>128)return;
          let diagnostic;
          try{diagnostic=await inspect(selected,'diagnostic',{question:data.question});}
          catch(error){if(socket===ws&&ws.readyState===1)ws.send(JSON.stringify({type:'result',id:data.id,error:error.message||'Диагностика недоступна'}));return;}
          if(socket===ws&&ws.readyState===1)ws.send(JSON.stringify({type:'result',id:data.id,diagnostic}));
        }
        else if(data.type==='question'&&authenticated){
          if(typeof data.id!=='string'||!data.id||data.id.length>128)return;
          if(seen.has(data.id))return;
          seen.add(data.id);
          if(running){ws.send(JSON.stringify({type:'result',id:data.id,error:'Предыдущий запрос ещё выполняется'}));return;}
          running=true;message='Выполняется запрос в фоне. Не вводите сообщения в выбранном чате.';
          let result;
          try{
            if(typeof submit!=='function')throw Error('Доверенная отправка ChatGPT не настроена');
            const prepared=await inspect(selected,'prepare',{question:data.question,image:data.image});
            await submit(selected);
            const deadline=Date.now()+145000;
            do{
              result=await inspect(selected,'collect',prepared);
              if(result?.pending)await wait(500);
            }while(result?.pending&&Date.now()<deadline);
            if(result?.pending)throw Error('Не удалось подтвердить завершение ответа. Проверьте чат перед повтором.');
          }
          catch(error){result={error:error.message||'Запрос не подтверждён'};}
          finally{running=false;}
          if(socket===ws&&ws.readyState===1){
            ws.send(JSON.stringify({type:'result',id:data.id,...result}));
            message=result.error||'Ответ передан JobGhost. Фоновое подключение активно.';
          }
        }
      };
      return state();
    }catch(error){if(attempt===generation)disconnect(error.message||'Не удалось подключиться');throw error;}
  }
  return {state,connect,disconnect};
}
