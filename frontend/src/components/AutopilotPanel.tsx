import {useState} from 'react';
import {useMutation, useQuery} from '@tanstack/react-query';

type PilotState = {status: string; enabled: boolean; error?: string; last_run?: string; next_run?: string; history: {at: string; found: number; saved: number;applied?:number}[]};
async function request(action: string, data?: unknown): Promise<PilotState> {
  const response = await fetch('/api/autopilot/' + action, data === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Проверьте запрос и интервал (от 5 до 1440 минут)');
  return result;
}

export function AutopilotPanel() {
  const [query, setQuery] = useState('Python');
  const [interval, setInterval] = useState(30);
  const [autoApply,setAutoApply]=useState(false);
  const [resumeId,setResumeId]=useState('');
  const status = useQuery({queryKey: ['autopilot'], queryFn: () => request('status'), refetchInterval: 3000});
  const resumes=useQuery({queryKey:['resumes'],queryFn:async()=>{const response=await fetch('/api/resumes');if(!response.ok)throw Error('Не удалось загрузить резюме');return response.json();}});
  const start = useMutation({mutationFn: () => request('start', {query, interval_minutes: interval,auto_apply:autoApply,resume_id:autoApply?resumeId:null}), onSuccess: () => status.refetch()});
  const pause = useMutation({mutationFn: () => request('pause', {}), onSuccess: () => status.refetch()});
  const labels: Record<string, string> = {paused: 'На паузе', starting: 'Запускается', running: 'Ищет вакансии', waiting: 'Ждёт следующего поиска', needs_attention: 'Нужно ваше действие'};
  return <section className="panel" style={{padding: 20, marginBottom: 20}}>
    <h2>Автопилот HH</h2>
    <p>Ищет вакансии по расписанию, пока запущено приложение и компьютер не спит. По желанию составляет письмо через ваш ChatGPT и отправляет не более одного отклика за цикл.</p>
    <div className="toolbar">
      <label>Запрос <input aria-label="Запрос фонового поиска" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <label>Интервал, минут <input aria-label="Интервал фонового поиска" type="number" min={5} max={1440} value={interval} onChange={e => setInterval(Number(e.target.value))}/></label>
      <button disabled={start.isPending || !query.trim() || (autoApply&&!resumeId) || status.data?.enabled} onClick={() => start.mutate()}>Запустить в фоне</button>
      <button className="secondary" disabled={pause.isPending} onClick={() => pause.mutate()}>Пауза</button>
    </div>
    <label className="settings-toggle"><input type="checkbox" checked={autoApply} disabled={status.data?.enabled} onChange={e=>setAutoApply(e.target.checked)}/><span><b>Автоматически откликаться</b><small>Реальные отклики работодателям. При капче или дополнительных вопросах автопилот остановится.</small></span></label>
    {autoApply&&<label>Резюме для автооткликов <select aria-label="Резюме для автооткликов" value={resumeId} disabled={status.data?.enabled} onChange={e=>setResumeId(e.target.value)}><option value="">Выберите резюме HH</option>{resumes.data?.filter((resume:{is_active:boolean;hh_resume_id?:string})=>resume.is_active&&resume.hh_resume_id).map((resume:{id:string;name:string})=><option value={resume.id} key={resume.id}>{resume.name}</option>)}</select></label>}
    <p role="status">{labels[status.data?.status || ''] || 'Проверка…'}</p>
    {status.data?.next_run && <p>Следующий поиск: {new Date(status.data.next_run).toLocaleString('ru-RU')}</p>}
    {(status.data?.error || start.error || pause.error || status.error) && <p role="alert">{status.data?.error || start.error?.message || pause.error?.message || status.error?.message}</p>}
    <p>При проблемах на hh.ru поиск остановится. Открытие входа или вакансии вручную ставит фоновый поиск на паузу.</p>
    {status.data?.history?.slice(-3).reverse().map(h => <p key={h.at}>{new Date(h.at).toLocaleString('ru-RU')}: найдено {h.found}, добавлено {h.saved}{h.applied!==undefined?`, откликов ${h.applied}`:''}</p>)}
  </section>;
}
