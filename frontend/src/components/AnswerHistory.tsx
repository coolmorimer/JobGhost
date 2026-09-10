import {useEffect,useRef} from 'react';
export type AnswerEntry = {question:string; answer:string;image?:string};

export function AnswerHistory({entries, index, onSelect,conversation=false,pendingQuestion,recognizedQuestion,recognizedSource,recognizedQuestionDetected=true}: {
  entries:AnswerEntry[]; index:number; onSelect:(index:number)=>void;conversation?:boolean;pendingQuestion?:string;recognizedQuestion?:string;recognizedSource?:string;recognizedQuestionDetected?:boolean;
}) {
  const log=useRef<HTMLElement>(null);
  const answer=useRef<HTMLElement>(null);
  useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[entries.length,pendingQuestion]);
  useEffect(()=>{if(answer.current)answer.current.scrollTop=0;},[entries.length,index]);
  if(conversation)return <section ref={log} className="chat-log" role="log" aria-label="Переписка с помощником" aria-live="polite">
    {!entries.length&&!pendingQuestion&&<div className="chat-welcome"><h1>Чем помочь?</h1><p>Напишите вопрос или включите голос в настройках.</p></div>}
    {entries.map((entry,i)=><div className="chat-turn" key={i}><div className="chat-message user-message"><small>Вы</small>{entry.image&&<img className="chat-sent-image" src={entry.image} alt="Отправленная область экрана"/>}<p>{entry.question}</p></div><div className="chat-message assistant-message"><small>Помощник</small><p>{entry.answer}</p></div></div>)}
    {pendingQuestion&&<div className="chat-turn"><div className="chat-message user-message"><small>Вы</small><p>{pendingQuestion}</p></div><div className="chat-message assistant-message" role="status">Думаю над ответом…</div></div>}
    {recognizedQuestion&&<div className="chat-turn"><div className="chat-message recognized-message"><small>{recognizedQuestionDetected?'Обнаружен вопрос':'Распознана речь'} · {recognizedSource||'голос'}</small><p>{recognizedQuestion}</p></div><div className="chat-message assistant-message" role="status">{recognizedQuestionDetected?'Будет отправлен автоматически, если включён этот режим. ':'Не определено как вопрос. '}Нажмите Ctrl+Enter для ручной отправки.</div></div>}
  </section>;
  const entry = entries[index];
  if (!entry) return <p>Ответов пока нет. Подключите ChatGPT и задайте вопрос.</p>;
  return <section ref={answer} aria-label="История ответов">
    <div className="toolbar">
      <button className="secondary" aria-label="Предыдущий ответ" disabled={index === 0} onClick={()=>onSelect(index-1)}>← Назад</button>
      <span role="status">{index+1} / {entries.length}</span>
      <button className="secondary" aria-label="Следующий ответ" disabled={index === entries.length-1} onClick={()=>onSelect(index+1)}>Вперёд →</button>
    </div>
    <p><b>Вопрос:</b> {entry.question}</p>
    <div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}} aria-live="polite">{entry.answer}</div>
    <small>История хранится только в памяти этой страницы.</small>
  </section>;
}
