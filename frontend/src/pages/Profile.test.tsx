import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {test,expect,vi,afterEach} from 'vitest';
import {Profile} from './Profile';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
test('Russian profile fields preserve experience and unedited data when saving',async()=>{
  const profile={id:'fixture',name:'Иван',skills:{Python:'senior'},experience:[{company:'Fixture',years:5}],preferences:{custom:true},desired_roles:['Разработчик']};
  let saved:Record<string,unknown>|undefined;
  vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{
    if(options?.method==='PUT')saved=JSON.parse(String(options.body));
    return {ok:true,json:async()=>profile};
  }));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Profile/></QueryClientProvider>);
  const name=await screen.findByLabelText('Ваше имя');fireEvent.change(name,{target:{value:'Пётр'}});
  fireEvent.click(screen.getByText('Сохранить профиль'));
  await waitFor(()=>expect(saved?.name).toBe('Пётр'));
  expect(saved?.experience).toEqual(profile.experience);expect(saved?.preferences).toEqual(profile.preferences);
  expect(saved?.skills).toEqual(profile.skills);expect(saved?.id).toBeUndefined();
});
