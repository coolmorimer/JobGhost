import {describe,expect,test} from 'vitest';
import {VoiceUtteranceAssembler} from './VoiceUtteranceAssembler';

describe('VoiceUtteranceAssembler',()=>{
  test('собирает вопрос через границу аудиофрагментов',()=>{
    const value=new VoiceUtteranceAssembler();
    expect(value.add({text:'Как работает асинхронное',isQuestion:true,language:'ru'})).toMatchObject({text:'Как работает асинхронное',complete:false});
    expect(value.add({text:'программирование в Python?',isQuestion:true,language:'ru'})).toMatchObject({text:'Как работает асинхронное программирование в Python?',isQuestion:true,language:'ru',complete:false});
    expect(value.add({text:'',isQuestion:false,language:'ru'})).toEqual({text:'Как работает асинхронное программирование в Python?',isQuestion:true,language:'ru',complete:true});
  });

  test('пауза завершает реплику даже без вопросительного знака',()=>{
    const value=new VoiceUtteranceAssembler();
    value.add({text:'Расскажите про ваш опыт с Docker',isQuestion:true,language:'ru'});
    expect(value.add({text:'',isQuestion:false,language:'ru'})).toEqual({text:'Расскажите про ваш опыт с Docker',isQuestion:true,language:'ru',complete:true});
  });

  test('убирает повтор на перекрывающихся фрагментах',()=>{
    const value=new VoiceUtteranceAssembler();
    value.add({text:'What is dependency injection',isQuestion:true,language:'en'});
    expect(value.add({text:'dependency injection in FastAPI?',isQuestion:true,language:'en'})?.text).toBe('What is dependency injection in FastAPI?');
  });
});
