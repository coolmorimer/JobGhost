import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {test,expect,vi,afterEach} from 'vitest';
import {Preparation} from './Preparation';

afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();});
test('materials are explicitly selected and saving sessions is opt-in',async()=>{
  const requests:{url:string;body:Record<string,unknown>}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if(options?.body) requests.push({url,body:JSON.parse(String(options.body))});
    const data=url.endsWith('/status')?{ready:true}:url.endsWith('/session/start')?{session_id:'new-session'}:[];
    return {ok:true,json:async()=>data};
  }));
  render(<Preparation/>);
  await screen.findByText(/Поиск по смыслу готов/);
  expect((screen.getByLabelText('Сохранять следующие сессии на этом компьютере') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByText('Применить и открыть чат'));
  await waitFor(()=>expect(sessionStorage.getItem('jobghost-session')).toBe('new-session'));
  expect(requests[0].body.save_history).toBe(false);
  expect(requests[0].body.document_ids).toEqual([]);
});

test('plan needs a selected vacancy; coach shows server error without fabricated score',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>({ok:!options?.body,json:async()=>options?.body?{detail:'Модель недоступна'}:url.endsWith('/status')?{ready:true}:[]})));
  render(<Preparation/>);
  await screen.findByText(/Поиск по смыслу готов/);
  expect((screen.getByText('Составить план подготовки') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Вопрос'),{target:{value:'Что такое Python?'}});
  fireEvent.change(screen.getByLabelText('Ваш ответ'),{target:{value:'Язык программирования'}});
  fireEvent.click(screen.getByText('Оценить мой ответ'));
  expect((await screen.findByRole('alert')).textContent).toContain('Модель недоступна');
  expect(screen.queryByLabelText('Разбор ответа')).toBeNull();
});
