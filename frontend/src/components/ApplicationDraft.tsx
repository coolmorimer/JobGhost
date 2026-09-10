import {useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

async function draftRequest(path: string, body?: unknown) {
  const response = await fetch('/api/' + path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Некорректные данные');
  return data;
}

export function ApplicationDraft({vacancyId}: {vacancyId:string}) {
  const [resume, setResume] = useState('');
  const qc = useQueryClient();
  const resumes = useQuery({queryKey:['resumes'],queryFn:()=>draftRequest('resumes')});
  const prepare = useMutation({mutationFn:()=>draftRequest('applications',{vacancy_id:vacancyId,resume_id:resume}),onSuccess:()=>qc.invalidateQueries({queryKey:['applications']})});
  return <div style={{marginTop:20}}><h3>Подготовить отклик</h3>
    <select aria-label="Резюме для отклика" value={resume} onChange={e=>setResume(e.target.value)}><option value="">Выберите резюме явно</option>{resumes.data?.filter((r:{is_active:boolean})=>r.is_active).map((r:{id:string;name:string;hh_resume_id?:string})=><option key={r.id} value={r.id}>{r.name}{r.hh_resume_id ? ' · HH' : ' · локальное'}</option>)}</select>
    <button disabled={!resume || prepare.isPending} onClick={()=>prepare.mutate()}>Создать черновик</button>
    {prepare.error && <p role="alert">{prepare.error.message}</p>}
    {prepare.data && <p>Черновик создан. Откройте раздел «Отклики» для подготовки письма. Ничего не отправлено.</p>}
  </div>;
}

export function LetterEditor({id}: {id:string}) {
  const [text,setText] = useState<string|null>(null);
  const [showPrompt,setShowPrompt] = useState(false);
  const [confirmed,setConfirmed] = useState(false);
  const [preflightReady,setPreflightReady] = useState(false);
  const qc=useQueryClient();
  const info = useQuery({queryKey:['letter',id],queryFn:()=>draftRequest(`application-letters/${id}`)});
  const generate = useMutation({mutationFn:()=>draftRequest(`application-letters/${id}/generate`,{}),onSuccess:data=>{setText(data.text); void info.refetch();}});
  const save = useMutation({mutationFn:()=>draftRequest(`application-letters/${id}/save`,{text:text ?? info.data?.text ?? ''}),onSuccess:()=>{setPreflightReady(false);setConfirmed(false);void info.refetch();}});
  const preflight=useMutation({mutationFn:()=>draftRequest(`hh-browser/applications/${id}/preflight`,{}),onSuccess:data=>setPreflightReady(data.state==='ready')});
  const send=useMutation({mutationFn:()=>draftRequest(`hh-browser/applications/${id}/send`,{confirm:true}),onSuccess:()=>{setPreflightReady(false);setConfirmed(false);void qc.invalidateQueries({queryKey:['applications']});}});
  return <section className="panel" style={{padding:20,marginTop:12}}>
    <h3>{info.data?.vacancy || 'Письмо'} — {info.data?.company}</h3><p>Резюме: {info.data?.resume}</p>
    <button className="secondary" onClick={()=>setShowPrompt(!showPrompt)}>Что будет отправлено в ChatGPT</button>
    {showPrompt && <pre style={{whiteSpace:'pre-wrap',maxHeight:260,overflow:'auto'}}>{info.data?.prompt}</pre>}
    <p>Генерация отправит показанные данные в ваш ChatGPT. Проверьте факты перед использованием.</p>
    <button disabled={generate.isPending || !!info.error} onClick={()=>generate.mutate()}>{generate.isPending ? 'Создаётся…' : 'Составить письмо через ChatGPT'}</button>
    <textarea aria-label="Сопроводительное письмо" rows={9} style={{width:'100%'}} value={text ?? info.data?.text ?? ''} onChange={e=>setText(e.target.value)}/>
    <p>{(text ?? info.data?.text ?? '').length} / 600–1200 символов</p>
    <button disabled={save.isPending || generate.isPending} onClick={()=>save.mutate()}>Сохранить черновик</button>
    {save.isSuccess && <p>Сохранено локально. Не отправлено.</p>}
    {info.data?.provider==='hh_browser'&&<div className="settings-card" style={{marginTop:16}}><h3>Отправка в HH</h3><p>Сначала сохраните письмо. Проверка откроет HH в фоне, подтвердит вход, вакансию и выбранное резюме. Если есть анкета или капча, отправка остановится.</p><button className="secondary" disabled={preflight.isPending||send.isPending} onClick={()=>{setPreflightReady(false);setConfirmed(false);preflight.mutate();}}>{preflight.isPending?'Проверяю HH…':'Проверить готовность HH'}</button>{preflight.data&&<p role="status">{preflight.data.message}</p>}{preflightReady&&<><label className="settings-toggle"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span><b>Я проверил письмо и резюме</b><small>Следующая кнопка отправит реальный отклик работодателю.</small></span></label><button disabled={!confirmed||send.isPending} onClick={()=>send.mutate()}>{send.isPending?'Отправляется…':'Отправить реальный отклик в HH'}</button></>}{send.isSuccess&&<p role="status">Отклик отправлен и подтверждён HH.</p>}</div>}
    {(info.error || generate.error || save.error || preflight.error || send.error) && <p role="alert">{info.error?.message || generate.error?.message || save.error?.message || preflight.error?.message || send.error?.message}</p>}
  </section>;
}
