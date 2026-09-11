import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {AnswerHistory} from './AnswerHistory';
afterEach(cleanup);
test('Ctrl arrows navigate and stop at history boundaries',()=>{
  const select=vi.fn();
  const entries=[{question:'Первый',answer:'Один'},{question:'Второй',answer:'Два'}];
  const {rerender}=render(<AnswerHistory entries={entries} index={0} onSelect={select}/>);
  fireEvent.keyDown(window,{key:'ArrowLeft',ctrlKey:true});
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(window,{key:'ArrowRight',ctrlKey:true});
  expect(select).toHaveBeenLastCalledWith(1);
  select.mockClear();
  rerender(<AnswerHistory entries={entries} index={1} onSelect={select} pendingQuestion="Генерация"/>);
  fireEvent.keyDown(window,{key:'ArrowLeft',ctrlKey:true});
  expect(select).not.toHaveBeenCalled();
});
test('empty history does not invent an answer',()=>{
  render(<AnswerHistory entries={[]} index={0} onSelect={()=>{}}/>);
  expect(screen.getByText(/Ответов пока нет/)).toBeTruthy();
});
test('navigation is bounded, formats markdown and keeps raw HTML inert',()=>{
  const select=vi.fn();
  const entries=[{question:'Первый',answer:'<script>bad()</script>'},{question:'Второй',answer:'**Ответ** два'}];
  const {rerender}=render(<AnswerHistory entries={entries} index={0} onSelect={select}/>);
  expect((screen.getByRole('button',{name:'Предыдущий ответ'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('<script>bad()</script>')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Следующий ответ'}));
  expect(select).toHaveBeenCalledWith(1);
  rerender(<AnswerHistory entries={entries} index={1} onSelect={select}/>);
  expect((screen.getByRole('button',{name:'Следующий ответ'}) as HTMLButtonElement).disabled).toBe(true);
  const formatted=screen.getByText('Ответ');
  expect(formatted.tagName).toBe('STRONG');
  expect(screen.getByText((_content,node)=>node?.tagName==='P'&&node.textContent==='Ответ два')).toBeTruthy();
});
