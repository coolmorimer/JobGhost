// Serialized by chrome.scripting into the explicitly selected tab, isolated world.
// No page-supplied code is evaluated, no cookies/network APIs are accessed.
export async function chatPage(operation, payload = {}, captureErrors = false) {
  let phase='проверка вкладки';
  try {
  if (location.origin !== 'https://chatgpt.com') throw Error('Откройте обычную вкладку ChatGPT');
  let editor = document.querySelector('#prompt-textarea');
  const stop = () => document.querySelector('[data-testid="stop-button"]');
  const send = () => {
    const known=document.querySelector('[data-testid="send-button"], #composer-submit-button');
    if(known)return known;
    const form=editor?.closest('form');
    const candidates=[...(form?.querySelectorAll('button') || [])].filter(button=>
      button.type==='submit' || /^(Send prompt|Send message|Send|Отправить запрос|Отправить сообщение|Отправить)$/i.test(button.getAttribute('aria-label') || ''));
    return candidates.length===1?candidates[0]:null;
  };
  const normalize = value => value.replace(/\s+/g,' ').trim();
  const text = element => (element?.innerText || element?.textContent || '').trim();
  const matchesSentQuestion = (observedValue, expectedValue) => {
    const observed=normalize(observedValue),expected=normalize(expectedValue);
    if(observed===expected)return true;
    // ChatGPT adds «Свернуть/Развернуть» and may render only a preview for long turns.
    // prepare() already verified the complete draft immediately before the trusted Enter.
    return expected.length>=1024&&observed.length>=256&&observed.slice(0,256)===expected.slice(0,256);
  };
  const draft = () => editor?.tagName === 'TEXTAREA' ? editor.value.trim() : text(editor);
  if (operation === 'status') {
    if(document.title!=='JobGhost Service')document.title='JobGhost Service';
    const ready=!!editor && !editor.hasAttribute('disabled');
    const submit=send();
    return {ready,busy:!!stop(),draft_present:!!draft(),send_ready:!!submit&&!submit.disabled,reason:ready?'connected':'editor_unavailable'};
  }
  const answers = () => [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const users = () => [...document.querySelectorAll('[data-message-author-role="user"]')];
  const answerText = node => {
    if(!node)return '';
    const turn=node.closest('[data-testid^="conversation-turn-"]');
    const candidates=[...(turn?.querySelectorAll('.markdown, .prose, [class*="markdown"], [class*="prose"]')||[])].map(text).filter(Boolean);
    return candidates.sort((left,right)=>right.length-left.length)[0]||text(node)||text(turn);
  };
  if(operation==='diagnostic'){
    const expected=typeof payload.question==='string'?normalize(payload.question):'';
    const observed=normalize(text(users().at(-1)));
    return {users:users().length,answers:answers().length,expected_length:expected.length,observed_length:observed.length,
      answer_length:normalize(answerText(answers().at(-1))).length,exact:observed===expected,
      prefix_match:expected.length>=256&&observed.slice(0,256)===expected.slice(0,256),busy:!!stop(),path_is_chat:location.pathname.startsWith('/c/')};
  }
  const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
  if(operation==='collect'){
    if(typeof payload.question!=='string'||!payload.question.trim()||!Number.isInteger(payload.user_count)||!Number.isInteger(payload.answer_count))throw Error('Некорректное ожидание ответа');
    phase='ожидание ответа после отправки';
    if(payload.path?.startsWith('/c/')&&location.pathname!==payload.path)throw Error('Выбранный чат изменился; ответ не сопоставлен.');
    const freshUsers=users().slice(payload.user_count);
    if(freshUsers.length>1)throw Error('В чате появились другие сообщения. Ответ не сопоставлен.');
    const confirmed=freshUsers.length===1&&matchesSentQuestion(text(freshUsers[0]),payload.question)&&(!payload.image_expected||freshUsers[0].querySelector('img'));
    if(!confirmed)return {pending:true};
    const last=answers().slice(payload.answer_count).at(-1);
    const answer=answerText(last);
    if(!answer||stop())return {pending:true};
    return {answer,image_attached:!!payload.image_expected};
  }
  if (operation !== 'ask' && operation !== 'prepare') throw Error('Неизвестная команда');
  if (!editor || editor.hasAttribute('disabled')) throw Error('Поле ChatGPT недоступно. Войдите вручную.');
  if (stop()) throw Error('В ChatGPT уже выполняется запрос. Новый не отправлен.');
  if (typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 16000) throw Error('Некорректный вопрос');
  const matchingDraft=normalize(draft())===normalize(payload.question);
  if (draft() && (!matchingDraft || payload.image)) throw Error('В ChatGPT есть другой черновик. Он не изменён; отправьте или удалите его вручную.');
  const composer=editor.closest('form');
  const attachments=()=>composer ? [...composer.querySelectorAll('img, [data-testid*="attachment"]')] : [];
  if(attachments().length || [...(composer?.querySelectorAll('input[type="file"]') || [])].some(input=>input.files?.length)) throw Error('В ChatGPT уже есть вложение. Оно не изменено; очистите черновик вручную.');
  let picture;
  if(payload.image!=null) {
    if(typeof payload.image!=='string' || payload.image.length>4000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.image)) throw Error('Некорректное изображение. Запрос не отправлен.');
    let bytes;
    try {bytes=Uint8Array.from(atob(payload.image),c=>c.charCodeAt(0));} catch {throw Error('Некорректное изображение. Запрос не отправлен.');}
    if(bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255)throw Error('Ожидается изображение JPEG. Запрос не отправлен.');
    if(!composer || typeof DataTransfer==='undefined' || typeof ClipboardEvent==='undefined')throw Error('Вставка снимка недоступна в этой версии страницы. Запрос не отправлен.');
    picture=new File([bytes],'jobghost-screen.jpg',{type:'image/jpeg'});
  }
  const oldAnswers = new Set(answers());
  const oldUsers = new Set(users());
  const path = location.pathname;
  const deadline=Date.now()+150000;
  phase='подготовка сообщения';
  editor.focus();
  let preview;
  if(picture) {
    // Synthetic paste carries only the requested file; the system clipboard is not read or changed.
    const transfer=new DataTransfer();transfer.items.add(picture);
    editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
    for(let i=0;i<100;i++) {
      if(!editor.isConnected || location.pathname!==path || draft())throw Error('Чат или черновик изменился при загрузке. Проверьте вкладку; отправки не было.');
      const images=[...composer.querySelectorAll('img')];
      if(images.length>1)throw Error('Появились другие вложения. Проверьте черновик; отправки не было.');
      preview=images[0];
      if(preview?.complete && preview.naturalWidth>0 && !composer.querySelector('[role="progressbar"], [aria-busy="true"]'))break;
      await sleep(250);
    }
    if(!preview?.complete || !preview.naturalWidth)throw Error('Снимок не появился в ChatGPT. Проверьте черновик; вопрос не отправлен.');
  }
  if (!matchingDraft && editor.tagName === 'TEXTAREA') {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,payload.question);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  } else if (!matchingDraft) {
    const selection = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
    if (!document.execCommand('insertText',false,payload.question)) throw Error('Не удалось заполнить поле. Проверьте черновик.');
  }
  let button;
  phase='поиск кнопки отправки';
  let readyTicks=0;
  const imageReady=()=>!picture || (preview?.isConnected && preview.complete && preview.naturalWidth>0 && composer.querySelectorAll('img').length===1 && !composer.querySelector('[role="progressbar"], [aria-busy="true"]'));
  for (let i=0;i<100;i++) {
    // React can replace the editor after focus/input. Never inspect the detached old node.
    editor=document.querySelector('#prompt-textarea');
    button=send();readyTicks=button && !button.disabled && imageReady()?readyTicks+1:0;
    if(readyTicks>=(picture?3:1))break;
    await sleep(100);
  }
  if (!button) throw Error('Кнопка отправки ChatGPT не найдена. Вопрос остался в поле ввода; отправки не было. Обновите расширение.');
  if (button.disabled || !imageReady() || readyTicks<(picture?3:1))throw Error('Отправка не подтверждена: кнопка или вложение ещё не готовы. Проверьте черновик. Повтора нет.');
  if(!editor?.isConnected)throw Error('Поле ввода ChatGPT изменилось. Отправки не было; проверьте вкладку.');
  if(location.pathname!==path)throw Error('Выбранный чат изменился до отправки. Проверьте вкладку.');
  if(normalize(draft())!==normalize(payload.question))throw Error('Текст в поле ChatGPT отличается от вопроса JobGhost. Отправки не было; проверьте черновик.');
  if(operation==='prepare')return {prepared:true,question:payload.question,path,user_count:oldUsers.size,answer_count:oldAnswers.size,image_expected:!!picture};
  phase='ожидание ответа после отправки';
  button.click(); // Exactly one send per request.
  let previous='', stable=0, confirmed=false;
  for (let i=0;i<290;i++) {
    await sleep(500);
    if(Date.now()>deadline)break;
    if (path.startsWith('/c/') && location.pathname !== path) throw Error('Выбранный чат изменился; ответ не сопоставлен.');
    const freshUsers=users().filter(node=>!oldUsers.has(node));
    if(freshUsers.length>1) throw Error('В чате появились другие сообщения. Ответ не сопоставлен.');
    if(freshUsers.length===1 && matchesSentQuestion(text(freshUsers[0]),payload.question) && (!picture || freshUsers[0].querySelector('img'))) confirmed=true;
    if (!confirmed) continue;
    const fresh=answers().filter(node=>!oldAnswers.has(node));
    const last=fresh.at(-1);
    const answer=answerText(last);
    // Require the completion toolbar in this response, not merely a pause in tokens.
    const turn=last?.closest('[data-testid^="conversation-turn-"]');
    const complete=turn?.querySelector('[data-testid="copy-turn-action-button"]');
    stable=answer && answer===previous && !stop() && complete ? stable+1 : 0;
    previous=answer;
    if(stable>=3) return {answer,image_attached:!!picture};
  }
  throw Error('Не удалось подтвердить завершение ответа. Проверьте чат перед повтором.');
  } catch(error) {
    // Chrome may discard rejected injected promises. Return a serializable error envelope.
    if(captureErrors)return {error:error instanceof Error?error.message:String(error),phase};
    throw error;
  }
}
