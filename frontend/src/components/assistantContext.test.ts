import {afterEach,expect,test} from 'vitest';
import {assistantContext} from './assistantContext';
afterEach(()=>localStorage.clear());
test('custom context never sends selected resume',()=>{
  localStorage.setItem('jobghost-interview-resume','private-resume');
  localStorage.setItem('jobghost-context-mode','custom');
  localStorage.setItem('jobghost-custom-prompt','Отвечай кратко');
  expect(assistantContext()).toEqual({context_mode:'custom',custom_prompt:'Отвечай кратко',resume_id:null});
  localStorage.setItem('jobghost-context-mode','resume');
  expect(assistantContext()).toEqual({context_mode:'resume',resume_id:'private-resume'});
});
