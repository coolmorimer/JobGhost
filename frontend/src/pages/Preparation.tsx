import {useEffect, useState} from 'react';
import Markdown from 'react-markdown';
import {assistantContext, preparationOptions} from '../components/assistantContext';
import {useUI} from '../stores/ui';
import './preparation.css';

type Material = {id:string; title:string; kind:'resume'|'project'|'experience'|'vacancy'; text:string; source:string};
type SavedSession = {id:string; title:string; turns:{question:string;answer:string}[]};
type Plan = {items:{question:string;answer:string}[];checklist:string[]};
type Coach = {score:number;explanation:string;improvements:string[];example:string};
const kinds = {resume:'Резюме', project:'Проект', experience:'Опыт работы', vacancy:'Вакансия'};
async function api<T>(path:string, body?:unknown, method='POST'):Promise<T> {
  const response = await fetch('/api/'+path, body===undefined?{}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if(!response.ok) throw Error(typeof data.detail==='string'?data.detail:'Проверьте заполнение полей');
  return data;
}

export function Preparation(){
  const [materials,setMaterials]=useState<Material[]>([]);
  const [sessions,setSessions]=useState<SavedSession[]>([]);
  const [selected,setSelected]=useState(preparationOptions().document_ids);
  const [save,setSave]=useState(preparationOptions().save_history);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [title,setTitle]=useState('');
  const [kind,setKind]=useState<Material['kind']>('project');
  const [text,setText]=useState('');
  const [url,setUrl]=useState('');
  const [question,setQuestion]=useState('');
  const [answer,setAnswer]=useState('');
  const [plan,setPlan]=useState<Plan>();
  const [coach,setCoach]=useState<Coach>();
  const setPage=useUI(s=>s.setPage);
  async function refresh(){
    const [docs,history,status]=await Promise.all([api<Material[]>('preparation/documents'),api<SavedSession[]>('preparation/sessions'),api<{ready:boolean}>('preparation/status')]);
    setMaterials(docs);setSessions(history);setReady(status.ready);
  }
  useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[]);
  async function run(label:string,action:()=>Promise<void>){
    setBusy(label);setError('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие');}finally{setBusy('');}
  }
  function select(ids:string[]){setSelected(ids);localStorage.setItem('jobghost-materials',JSON.stringify(ids));}
  function training(){return {...assistantContext(),document_ids:selected};}
  function exportPlan(){
    if(!plan)return;
    const markdown=['# План подготовки',...plan.items.map((item,i)=>`## ${i+1}. ${item.question}\n\n${item.answer}`),'## Чеклист',...plan.checklist.map(item=>`- ${item}`)].join('\n\n');
    const objectUrl=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));
    const link=document.createElement('a');link.href=objectUrl;link.download='JobGhost-подготовка.md';link.click();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }
  return <div className="preparation"><header><div><h1>Подготовка к интервью</h1><p>Добавьте реальные факты о себе, выберите вакансию и потренируйте ответы.</p></div></header>
    {error&&<p role="alert" className="prep-error">{error}</p>}
    {busy&&<p role="status">{busy}… Не закрывайте раздел.</p>}
    <fieldset disabled={Boolean(busy)} className="panel"><legend>1. Материалы и контекст</legend>
      <p>Тексты сохраняются локально. Выбранные фрагменты отправляются выбранному ИИ. Не добавляйте пароли и чужие персональные данные.</p>
      <div className="prep-row"><label>Название<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label><label>Тип<select value={kind} onChange={e=>setKind(e.target.value as Material['kind'])}>{Object.entries(kinds).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label></div>
      <label>Описание<textarea value={text} rows={5} minLength={20} maxLength={30000} onChange={e=>setText(e.target.value)} placeholder="Ваш вклад, технологии, подтверждённые результаты. Для вакансии — её требования."/></label>
      <button disabled={!title.trim()||text.trim().length<20} onClick={()=>void run('Сохраняю материал',async()=>{const doc=await api<{id:string}>('preparation/documents',{title,kind,text});select([...selected,doc.id].slice(-20));setTitle('');setText('');await refresh();})}>Добавить материал</button>
      <details><summary>Взять описание по ссылке HH</summary><p>Только чтение вакансии, без отклика. Если HH просит вход — войдите вручную в разделе «Вакансии».</p><label>Ссылка hh.ru<input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://hh.ru/vacancy/…"/></label><button disabled={!url.trim()} onClick={()=>void run('Читаю вакансию',async()=>{const doc=await api<{id:string}>('preparation/vacancy',{url});select([...selected,doc.id].slice(-20));await refresh();})}>Прочитать вакансию</button></details>
      <ul className="prep-materials">{materials.map(doc=><li key={doc.id}><label><input type="checkbox" checked={selected.includes(doc.id)} disabled={!selected.includes(doc.id)&&selected.length>=20} onChange={e=>select(e.target.checked?[...selected,doc.id]:selected.filter(x=>x!==doc.id))}/>{kinds[doc.kind]}: {doc.title}</label><details><summary>Текст и источник</summary><p>{doc.source}</p><pre>{doc.text}</pre></details><button className="ghost" onClick={()=>void run('Удаляю материал',async()=>{await api('preparation/documents/'+doc.id,{},'DELETE');select(selected.filter(x=>x!==doc.id));await refresh();})}>Удалить материал</button></li>)}</ul>
      <p>{ready?'Поиск по смыслу готов · RU / EN · локально':'Перед первым использованием материалов загрузите модель поиска. Это может занять несколько минут; повторная загрузка файлов не нужна.'}</p>
      <button onClick={()=>void run('Подготавливаю локальный поиск',async()=>{await api('preparation/load',{});await refresh();})}>{ready?'Проверить готовность поиска':'Подготовить поиск'}</button>
    </fieldset>
    <fieldset disabled={Boolean(busy)} className="panel"><legend>2. Память и чат</legend><p>Резюме или свой промпт выбираются в настройках помощника. Материалы выше дополняют эту роль. API-сессии изолированы. В браузерном ChatGPT прежняя переписка остаётся — для чистого контекста нужен новый чат.</p>
      <label><input type="checkbox" checked={save} onChange={e=>{setSave(e.target.checked);localStorage.setItem('jobghost-save-history',String(e.target.checked));}}/>Сохранять следующие сессии на этом компьютере</label>
      <p>Без сохранения история живёт до перезапуска сервера или 12 часов бездействия. Сохраняются только текст и ответы, не звук и изображения. Настройка действует на новую сессию. Удаление здесь не удаляет переписку у внешнего провайдера.</p>
      <button disabled={selected.length>0&&!ready} onClick={()=>void run('Начинаю новую сессию',async()=>{const result=await api<{session_id:string}>('ai/session/start',{...training(),save_history:save});sessionStorage.setItem('jobghost-session',result.session_id);window.dispatchEvent(new Event('jobghost-new-session'));setPage('Interviews');})}>Применить и открыть чат</button>
      {sessions.map(s=><details key={s.id}><summary>{s.title} · {s.turns.length} ответов</summary>{s.turns.map((t,i)=><article key={i}><b>{t.question}</b><Markdown>{t.answer}</Markdown></article>)}<button onClick={()=>void run('Удаляю историю',async()=>{await api('preparation/sessions/'+s.id,{},'DELETE');if(sessionStorage.getItem('jobghost-session')===s.id)sessionStorage.removeItem('jobghost-session');await refresh();})}>Удалить эту сессию</button></details>)}
    </fieldset>
    <fieldset disabled={Boolean(busy)} className="panel"><legend>3. План по вакансии</legend><p>30 вопросов с учебными ответами и технический чеклист. Генерация — 6 запросов выбранному ИИ, обычно дольше обычного ответа. В API возможна плата по тарифу провайдера.</p><button disabled={!ready||!materials.some(d=>d.kind==='vacancy'&&selected.includes(d.id))} onClick={()=>void run('Генерирую 30 вопросов и чеклист',async()=>{setPlan(undefined);setPlan(await api<Plan>('preparation/plan',training()));})}>Составить план подготовки</button>
      {plan&&<><button onClick={exportPlan}>Скачать план (.md)</button><p>План не сохраняется автоматически. Скачайте его перед уходом из раздела.</p><h2>Технический чеклист</h2><ul>{plan.checklist.map((item,i)=><li key={i}>{item}</li>)}</ul>{plan.items.map((item,i)=><details key={i}><summary>{i+1}. {item.question}</summary><Markdown>{item.answer}</Markdown><button onClick={()=>{setQuestion(item.question);setAnswer('');setCoach(undefined);document.getElementById('coach-answer')?.focus();}}>Потренировать этот вопрос</button></details>)}</>}
    </fieldset>
    <fieldset disabled={Boolean(busy)} className="panel"><legend>4. AI Coach — проверка вашего ответа</legend><label>Вопрос<textarea value={question} maxLength={4000} onChange={e=>setQuestion(e.target.value)}/></label><label>Ваш ответ<textarea id="coach-answer" value={answer} rows={5} maxLength={12000} onChange={e=>setAnswer(e.target.value)}/></label><button disabled={question.trim().length<3||answer.trim().length<3||(selected.length>0&&!ready)} onClick={()=>void run('Разбираю ваш ответ',async()=>{setCoach(undefined);setCoach(await api<Coach>('preparation/coach',{...training(),question,answer}));})}>Оценить мой ответ</button>
      {coach&&<article aria-label="Разбор ответа"><h2>{coach.score}/10 · учебная оценка</h2><p>{coach.explanation}</p><h3>Что улучшить</h3><ul>{coach.improvements.map((item,i)=><li key={i}>{item}</li>)}</ul><h3>Пример более точного ответа</h3><Markdown>{coach.example}</Markdown><p>Оценка ИИ может ошибаться и не предсказывает результат найма. Сверьте факты.</p></article>}
    </fieldset>
  </div>;
}
