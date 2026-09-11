import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,test,vi} from 'vitest';
import {ChatAnswer} from './ChatAnswer';
afterEach(()=>{cleanup();localStorage.clear();delete window.jobghostDesktop;vi.unstubAllGlobals();});
test('native compact mode keeps controls and hides technical status clutter',async()=>{
  const setCompact=vi.fn(async(compact:boolean)=>({compact,alwaysOnTop:compact,failedShortcuts:[]}));
  const quit=vi.fn(async()=>undefined);
  window.jobghostDesktop={setCompact,quit,getState:async()=>({compact:false,alwaysOnTop:false,failedShortcuts:[]}),onAction:()=>()=>{}};
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({state:'ready'})})));
  const stop=vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="" snapshot="" captureStatus="Микрофон ВКЛ" sessionActive onStartSession={async()=>({screen:true,mic:true})} onStop={stop}/></QueryClientProvider>);
  fireEvent.click(screen.getByText('Скрытый чат поверх окон'));
  await waitFor(()=>expect(setCompact).toHaveBeenCalledWith(true));
  fireEvent.click(await screen.findByLabelText('Настройки чата'));
  await screen.findByRole('heading',{name:'Основные'});
  await screen.findByText('Вернуться в большое окно');
  fireEvent.click(screen.getByRole('button',{name:'Выйти из JobGhost'}));
  expect(quit).toHaveBeenCalledTimes(1);
  expect(setCompact).toHaveBeenCalledWith(true);
  expect(screen.queryByText('Микрофон ВКЛ')).toBeNull();
  fireEvent.click(screen.getByLabelText('Остановить сессию'));expect(stop).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Вернуться в большое окно'));
  await screen.findByText('Скрытый чат поверх окон');
  expect(setCompact).toHaveBeenCalledWith(false);
});
test('repeated desktop ask action cannot send a duplicate pending request',async()=>{
  const listeners=new Set<(action:'ask'|'snapshot'|'stop')=>void>();
  window.jobghostDesktop={getState:async()=>({compact:false,alwaysOnTop:false,failedShortcuts:[]}),setCompact:async compact=>({compact,alwaysOnTop:false,failedShortcuts:[]}),onAction:callback=>{listeners.add(callback);return ()=>{listeners.delete(callback);};}};
  let finish:(value:unknown)=>void=()=>{};
  const ask=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,json:()=>path.endsWith('/ask') ? ask() : Promise.resolve({state:'ready'})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="Что такое HTTP?" snapshot=""/></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Вопрос ИИ'),{target:{value:'Что такое HTTP?'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Получить ответ'}) as HTMLButtonElement).disabled).toBe(false));
  act(()=>{listeners.forEach(callback=>callback('ask'));listeners.forEach(callback=>callback('ask'));});
  await waitFor(()=>expect(ask).toHaveBeenCalledTimes(1));
  await act(async()=>{finish({answer:'Тестовый ответ, не настоящий AI'});});
  await screen.findByText('Тестовый ответ, не настоящий AI');
  expect(ask).toHaveBeenCalledTimes(1);
});

test('capture automation preferences survive a renderer remount',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,json:async()=>path.endsWith('/settings')?{provider:'browser',openai_model:'gpt-4o-mini',openrouter_model:'auto',openai_key_saved:false,openrouter_key_saved:false,openai_models:[]}:{state:'ready'}})));
  const first=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="" snapshot=""/></QueryClientProvider>);
  await waitFor(()=>expect((screen.getByRole('button',{name:/Автоответ/}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/Автоответ/}));
  first.unmount();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="" snapshot="" onSnapshot={()=>undefined}/></QueryClientProvider>);
  expect(screen.getByRole('button',{name:/Автоответ/}).getAttribute('aria-pressed')).toBe('true');
});

test('screen is captured only after the explicit full-screen action',async()=>{
  const getSnapshot=vi.fn(async()=>'data:image/jpeg;base64,/9j/2Q==');
  const requests:{question:string;image:string|null}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
    if(path.endsWith('/ask'))requests.push(JSON.parse(String(options?.body)));
    return {ok:true,json:async()=>path.endsWith('/ask')?{answer:'fixture screen answer'}:{state:'ready'}};
  }));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="" snapshot="" onCaptureFullScreen={getSnapshot}/></QueryClientProvider>);
  expect(getSnapshot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/Прикрепить весь экран/}));
  await waitFor(()=>expect(getSnapshot).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Вопрос ИИ'),{target:{value:'Что на экране?'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Получить ответ'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Получить ответ'}));
  await screen.findByText('fixture screen answer');
  expect(getSnapshot).toHaveBeenCalledTimes(1);expect(requests).toHaveLength(1);
  expect(requests[0].image).toBe('/9j/2Q==');expect(requests[0].question).toContain('Что на экране?');
});

test('missing requested screenshot does not attach anything or send by itself',async()=>{
  const paths:string[]=[];
  const fetchMock=vi.fn(async(path:string)=>{paths.push(path);return {ok:true,json:async()=>({state:'ready'})};});vi.stubGlobal('fetch',fetchMock);
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="" snapshot="" onSnapshot={()=>undefined}/></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button',{name:/Прикрепить весь экран/}));
  await screen.findByText(/Снимок не получен/);
  expect(paths.every(path=>!path.endsWith('/ask'))).toBe(true);
});

test('disconnected state points to AI settings without asking for a code',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({state:'needs_extension',message:'Нужно настроить канал ИИ'})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="" snapshot=""/></QueryClientProvider>);
  expect(await screen.findByText(/Нужно настроить канал ИИ/)).toBeTruthy();
  expect(screen.queryByText(/код подключения/i)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Настроить'}));
  expect(screen.getByRole('heading',{name:'Настройки'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'ИИ и скорость'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Инструкция'}));
  expect(screen.getByText('Настройте ИИ')).toBeTruthy();
});

test('renders streamed answer deltas before the request completes',async()=>{
  const encoder=new TextEncoder();
  let release:()=>void=()=>{};
  const stream=new ReadableStream({start(controller){
    controller.enqueue(encoder.encode('data: {"type":"delta","delta":"Первый "}\n\n'));
    release=()=>{controller.enqueue(encoder.encode('data: {"type":"delta","delta":"фрагмент"}\n\ndata: {"type":"done"}\n\n'));controller.close();};
  }});
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/ask')
    ?new Response(stream,{headers:{'Content-Type':'text/event-stream'}})
    :({ok:true,json:async()=>({state:'ready',label:'OpenAI API'})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="" snapshot=""/></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Вопрос ИИ'),{target:{value:'Проверка потока'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Получить ответ'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Получить ответ'}));
  expect(await screen.findByText(/Первый/)).toBeTruthy();
  await act(async()=>release());
  expect(await screen.findByText('Первый фрагмент')).toBeTruthy();
});

test('recognized voice question is visible before manual send',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({state:'ready'})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="Как работает HTTP?" latestQuestionKey={1} latestQuestionSource="Микрофон" snapshot=""/></QueryClientProvider>);
  expect((await screen.findAllByText('Как работает HTTP?')).length).toBeGreaterThan(0);
  expect((screen.getByLabelText('Вопрос ИИ') as HTMLTextAreaElement).value).toBe('Как работает HTTP?');
  expect(screen.getByText(/Обнаружен вопрос · Микрофон/)).toBeTruthy();
  expect(screen.getAllByText(/Ctrl\+Enter/).length).toBeGreaterThan(0);
});

test('compact mode keeps the spoken question visible after the answer',async()=>{
  window.jobghostDesktop={getState:async()=>({compact:false,alwaysOnTop:false,failedShortcuts:[]}),setCompact:async compact=>({compact,alwaysOnTop:compact,failedShortcuts:[]}),onAction:()=>()=>{}};
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,json:async()=>path.endsWith('/ask')?{answer:'Ответ готов'}:{state:'ready'}})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="Как работает event loop?" latestQuestionKey={11} latestQuestionSource="Собеседник" snapshot=""/></QueryClientProvider>);
  fireEvent.click(screen.getByText('Скрытый чат поверх окон'));
  const input=screen.getByLabelText('Вопрос ИИ') as HTMLTextAreaElement;
  expect(input.value).toBe('Как работает event loop?');
  await waitFor(()=>expect((screen.getByText('Спросить').closest('button') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(input,{key:'Enter',ctrlKey:true});
  await screen.findByText('Ответ готов');
  expect(input.value).toBe('Как работает event loop?');
});

test('ctrl enter sends the latest voice phrase even when it was not detected as a question',async()=>{
  const requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
    if(path.endsWith('/ask'))requests.push(JSON.parse(String(options?.body)).question);
    return {ok:true,json:async()=>path.endsWith('/ask')?{answer:'manual voice answer'}:{state:'ready'}};
  }));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChatAnswer latestQuestion="Tell me about Docker" latestQuestionKey={7} latestQuestionSource="Микрофон · EN" latestQuestionDetected={false} snapshot=""/></QueryClientProvider>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Получить ответ'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(screen.getByLabelText('Вопрос ИИ'),{key:'Enter',ctrlKey:true});
  await screen.findByText('manual voice answer');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('Tell me about Docker');
});

test('one button enables voice auto-send and repeated wording remains a new question',async()=>{
  const requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
    if(path.endsWith('/ask'))requests.push(JSON.parse(String(options?.body)).question);
    return {ok:true,json:async()=>path.endsWith('/ask')?{answer:`answer ${requests.length}`}:{state:'ready'}};
  }));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const start=vi.fn(async()=>({screen:true,mic:true}));
  const capture=()=>"data:image/jpeg;base64,/9j/2Q==";
  const view=render(<QueryClientProvider client={client}><ChatAnswer latestQuestion="" snapshot="" getSnapshot={capture} onStartSession={start}/></QueryClientProvider>);
  await waitFor(()=>expect(screen.getByText('Начать сессию')).toBeTruthy());
  fireEvent.click(screen.getByText('Начать сессию'));
  await waitFor(()=>expect(start).toHaveBeenCalledTimes(1));
  view.rerender(<QueryClientProvider client={client}><ChatAnswer latestQuestion="Что такое React?" latestQuestionKey={1} latestQuestionSource="Системный звук" snapshot="" getSnapshot={capture} sessionActive onStartSession={start}/></QueryClientProvider>);
  await waitFor(()=>expect(requests).toHaveLength(1));
  view.rerender(<QueryClientProvider client={client}><ChatAnswer latestQuestion="Что такое React?" latestQuestionKey={2} latestQuestionSource="Микрофон" snapshot="" getSnapshot={capture} sessionActive onStartSession={start}/></QueryClientProvider>);
  await waitFor(()=>expect(requests).toHaveLength(2));
});
