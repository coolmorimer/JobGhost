import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {OverlaySettings} from './OverlaySettings';
afterEach(()=>{cleanup();delete window.jobghostDesktop;});
test('reads native settings on reopen and sends opacity changes',async()=>{
  const setOverlay=vi.fn(async(options)=>({opacity:0.6,passthrough:false,protection:options.protection ?? true,protected:options.protection ?? true}));
  window.jobghostDesktop={getState:async()=>({compact:true,alwaysOnTop:true,failedShortcuts:[],overlay:{opacity:0.7,passthrough:false,protection:true,protected:true}}),setCompact:async compact=>({compact,alwaysOnTop:compact,failedShortcuts:[]}),onAction:()=>()=>{},setOverlay};
  const view=render(<OverlaySettings/>);
  await waitFor(()=>expect((screen.getByLabelText('Прозрачность чата') as HTMLInputElement).value).toBe('30'));
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('Прозрачность чата'),{target:{value:'40'}});
  await waitFor(()=>expect(setOverlay).toHaveBeenCalledWith({opacity:0.6}));
  fireEvent.click(screen.getByLabelText('Защита окна от записи'));
  await waitFor(()=>expect(setOverlay).toHaveBeenCalledWith({protection:false}));
  view.unmount();render(<OverlaySettings/>);
  await waitFor(()=>expect((screen.getByLabelText('Прозрачность чата') as HTMLInputElement).value).toBe('30'));
});
