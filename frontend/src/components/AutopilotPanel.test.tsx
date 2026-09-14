import {afterEach, expect, test, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AutopilotPanel} from './AutopilotPanel';

afterEach(()=>{cleanup(); localStorage.clear(); vi.unstubAllGlobals();});

test('defaults to HH recommendations and never enables unattended sending', async()=>{
  const calls: Array<{url:string; body?: Record<string, unknown>}> = [];
  vi.stubGlobal('fetch', vi.fn(async(input: RequestInfo | URL, init?: RequestInit)=>{
    const url=String(input);
    if(url==='/api/resumes') return {ok:true,json:async()=>[{id:'resume-1',name:'Fullstack-разработчик',is_active:true,hh_resume_id:'hh1'}]};
    if(url.endsWith('/status')) return {ok:true,json:async()=>({status:'paused',enabled:false,history:[],source:'recommendations',resume_id:'resume-1',auto_apply:true,required_words:'python'})};
    if(url.endsWith('/start')) {
      calls.push({url,body:JSON.parse(String(init?.body))});
      return {ok:true,json:async()=>({status:'starting',enabled:true,history:[]})};
    }
    return {ok:true,json:async()=>({status:'paused',enabled:false,history:[]})};
  }));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AutopilotPanel/></QueryClientProvider>);
  expect(await screen.findByText('Подходящие от HH')).toBeTruthy();
  await waitFor(()=>expect((screen.getByRole('combobox',{name:'Резюме для автопилота'}) as HTMLSelectElement).value).toBe('resume-1'));
  fireEvent.click(screen.getByRole('button',{name:'Запустить автопилот'}));
  await waitFor(()=>expect(calls).toHaveLength(1));
  expect(calls[0].body).toMatchObject({source:'recommendations',resume_id:'resume-1',prepare_only:true,required_words:'python'});
});
