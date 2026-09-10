import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from '../../frontend/node_modules/jsdom/lib/api.js';
import {chatPage} from '../page.js';

function fixture(url='https://chatgpt.com/c/test') {
  const dom=new JSDOM('<textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button><div data-message-author-role="assistant">Old answer must not be returned</div>',{url,runScripts:'outside-only'});
  const w=dom.window;
  w.setTimeout=fn=>setTimeout(fn,0);
  let sends=0;
  const editor=w.document.querySelector('textarea');
  const button=w.document.querySelector('button');
  button.addEventListener('click',()=>{sends++;});
  const run=(operation,payload={})=>{
    w.operation=operation; w.payload=payload;
    return w.eval(`(${chatPage.toString()})(operation,payload)`);
  };
  return {dom,w,editor,button,run,sends:()=>sends};
}
test('does not touch a different origin',async()=>{
  const f=fixture('https://example.com');
  await assert.rejects(f.run('ask',{question:'hello'}),/ChatGPT/);
  assert.equal(f.sends(),0);f.dom.window.close();
});
test('keeps an existing draft unchanged',async()=>{
  const f=fixture();f.editor.value='personal draft';
  await assert.rejects(f.run('ask',{question:'hello'}),/черновик/);
  assert.equal(f.editor.value,'personal draft');assert.equal(f.sends(),0);f.dom.window.close();
});

test('status exposes only safe composer diagnostics',async()=>{
  const f=fixture();f.editor.value='draft';f.button.disabled=true;
  const result=await f.run('status');
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{ready:true,busy:false,draft_present:true,send_ready:false,reason:'connected'});f.dom.window.close();
});

test('prepares without clicking and collects the matching completed turn',async()=>{
  const f=fixture();
  const prepared=await f.run('prepare',{question:'hello'});
  assert.equal(prepared.prepared,true);assert.equal(f.sends(),0);assert.equal(f.editor.value,'hello');
  const user=f.w.document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent='hello';f.w.document.body.append(user);
  const turn=f.w.document.createElement('article');turn.dataset.testid='conversation-turn-3';turn.innerHTML='<div data-message-author-role="assistant">trusted answer</div><button aria-label="Копировать"></button>';f.w.document.body.append(turn);
  const result=await f.run('collect',prepared);
  assert.equal(result.answer,'trusted answer');assert.equal(f.sends(),0);f.dom.window.close();
});

test('collects a completed long turn when ChatGPT adds its expand control text',async()=>{
  const f=fixture();
  const question='Роль по резюме. '+('Подтверждённый опыт кандидата. '.repeat(80));
  const prepared=await f.run('prepare',{question});
  const user=f.w.document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=question+' Свернуть';f.w.document.body.append(user);
  const answer=f.w.document.createElement('div');answer.dataset.messageAuthorRole='assistant';answer.textContent='Роль по резюме загружена.';f.w.document.body.append(answer);
  const result=await f.run('collect',prepared);
  assert.equal(result.answer,'Роль по резюме загружена.');f.dom.window.close();
});

test('collects answer text from the turn when the assistant marker is empty',async()=>{
  const f=fixture();const prepared=await f.run('prepare',{question:'hello'});
  const user=f.w.document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent='hello';f.w.document.body.append(user);
  const turn=f.w.document.createElement('article');turn.dataset.testid='conversation-turn-3';turn.innerHTML='<div data-message-author-role="assistant"></div><div class="markdown prose">answer in sibling</div>';f.w.document.body.append(turn);
  const result=await f.run('collect',prepared);
  assert.equal(result.answer,'answer in sibling');f.dom.window.close();
});

test('single collect snapshot stays pending without background page timers',async()=>{
  const f=fixture();
  const prepared=await f.run('prepare',{question:'hello'});
  const result=await f.run('collect',prepared);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{pending:true});f.dom.window.close();
});

test('returns a useful serializable error to the worker',async()=>{
  const f=fixture();f.editor.value='private draft';
  f.w.question='hello';
  const result=await f.w.eval(`(${chatPage.toString()})('ask',{question},true)`);
  assert.match(result.error,/другой черновик/);assert.equal(f.sends(),0);f.dom.window.close();
});

test('supports current composer submit id and resumes only an identical draft',async()=>{
  const f=fixture();f.button.removeAttribute('data-testid');f.button.id='composer-submit-button';f.editor.value='hello';
  f.button.addEventListener('click',()=>{
    const user=f.w.document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=f.editor.value;f.editor.value='';f.w.document.body.append(user);
    const turn=f.w.document.createElement('article');turn.dataset.testid='conversation-turn-3';
    turn.innerHTML='<div data-message-author-role="assistant">answer</div><button data-testid="copy-turn-action-button"></button>';f.w.document.body.append(turn);
  });
  assert.equal((await f.run('ask',{question:'hello'})).answer,'answer');assert.equal(f.sends(),1);f.dom.window.close();
});

test('missing send button reports not sent and preserves the filled draft',async()=>{
  const f=fixture();f.button.remove();
  await assert.rejects(f.run('ask',{question:'hello'}),/Кнопка отправки.*не найдена/);
  assert.equal(f.editor.value,'hello');assert.equal(f.sends(),0);f.dom.window.close();
});
test('does not silently drop requested image',async()=>{
  const f=fixture();
  await assert.rejects(f.run('ask',{question:'hello',image:'abc'}),/изображение/);
  assert.equal(f.sends(),0);f.dom.window.close();
});
test('returns only the new completed response, once',async()=>{
  const f=fixture();
  f.button.addEventListener('click',()=>{
    const user=f.w.document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=f.editor.value;
    f.w.document.body.append(user);f.editor.value='';
    const turn=f.w.document.createElement('article');turn.dataset.testid='conversation-turn-3';
    turn.innerHTML='<div data-message-author-role="assistant"><div class="markdown">fixture new answer</div></div><button data-testid="copy-turn-action-button"></button>';
    f.w.document.body.append(turn);
  });
  const result=await f.run('ask',{question:'hello'});
  assert.equal(result.answer,'fixture new answer');assert.equal(f.sends(),1);f.dom.window.close();
});
test('does not return an old answer or resend on timeout',async()=>{
  const f=fixture();
  await assert.rejects(f.run('ask',{question:'hello'}),/завершение/);
  assert.equal(f.sends(),1);f.dom.window.close();
});
test('blocks while another response is being generated',async()=>{
  const f=fixture();f.button.dataset.testid='stop-button';
  await assert.rejects(f.run('ask',{question:'hello'}),/выполняется/);
  assert.equal(f.sends(),0);f.dom.window.close();
});

const jpeg='/9j/2Q=='; // Deliberately tiny byte fixture, not a real screenshot or AI result.
function imageFixture({preview=true,busy=false,userImage=true}={}){
  const f=fixture();const d=f.w.document;
  const form=d.createElement('form');f.editor.before(form);form.append(f.editor,f.button);
  f.button.type='button';
  f.w.DataTransfer=class {files=[];items={add:file=>this.files.push(file)};};
  f.w.ClipboardEvent=class extends f.w.Event {constructor(type,options){super(type,options);this.clipboardData=options.clipboardData;}};
  let pasted;
  f.editor.addEventListener('paste',event=>{
    pasted=event.clipboardData.files[0];
    if(preview){
      const img=d.createElement('img');img.alt='jobghost-screen.jpg';
      Object.defineProperties(img,{complete:{value:true},naturalWidth:{value:2}});form.append(img);
    }
    if(busy){const progress=d.createElement('div');progress.setAttribute('role','progressbar');form.append(progress);}
  });
  f.button.addEventListener('click',()=>{
    const user=d.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=f.editor.value;f.editor.value='';
    if(userImage){const img=form.querySelector('img');if(img)user.append(img);}
    d.body.append(user);
    const turn=d.createElement('article');turn.dataset.testid='conversation-turn-3';
    turn.innerHTML='<div data-message-author-role="assistant"><div class="markdown">image fixture answer</div></div><button data-testid="copy-turn-action-button"></button>';d.body.append(turn);
  });
  return {...f,form,pasted:()=>pasted};
}
test('pastes requested JPEG and confirms image in the new user message',async()=>{
  const f=imageFixture();
  try{
    const result=await f.run('ask',{question:'describe screen',image:jpeg});
    assert.equal(result.answer,'image fixture answer');assert.equal(result.image_attached,true);
    assert.equal(f.pasted().name,'jobghost-screen.jpg');assert.equal(f.pasted().type,'image/jpeg');assert.equal(f.sends(),1);
  }finally{f.dom.window.close();}
});
test('image paste not accepted by the page never sends a text-only question',async()=>{
  const f=imageFixture({preview:false});
  try{await assert.rejects(f.run('ask',{question:'describe screen',image:jpeg}),/Снимок не появился/);assert.equal(f.sends(),0);assert.equal(f.editor.value,'');}
  finally{f.dom.window.close();}
});
test('upload progress blocks sending',async()=>{
  const f=imageFixture({busy:true});
  try{await assert.rejects(f.run('ask',{question:'describe screen',image:jpeg}),/Отправка не подтверждена/);assert.equal(f.sends(),0);}
  finally{f.dom.window.close();}
});
test('pre-existing image draft is preserved even for a text question',async()=>{
  const f=imageFixture();f.form.append(f.w.document.createElement('img'));
  try{await assert.rejects(f.run('ask',{question:'hello'}),/уже есть вложение/);assert.equal(f.sends(),0);assert.equal(f.editor.value,'');assert.equal(f.form.querySelectorAll('img').length,1);}
  finally{f.dom.window.close();}
});
test('text-only user turn cannot confirm delivery of an image request',async()=>{
  const f=imageFixture({userImage:false});
  try{await assert.rejects(f.run('ask',{question:'describe screen',image:jpeg}),/завершение/);assert.equal(f.sends(),1);}
  finally{f.dom.window.close();}
});
