import {useEffect, useRef, useState} from 'react';
import {useMutation, useQuery} from '@tanstack/react-query';

function savedConfig(){try{return JSON.parse(localStorage.getItem('jobghost-pilot-config') || '{}');}catch{return {};}}

type Source = 'recommendations' | 'search';
type PilotState = {
  status: string; enabled: boolean; error?: string; last_run?: string; next_run?: string;
  source?: Source; query?: string; interval_minutes?: number; auto_apply?: boolean; resume_id?: string | null;
  daily_limit?: number; excluded_companies?: string; excluded_words?: string; required_words?: string; letter_instructions?: string;
  result?: {found?: number; saved?: number; prepared?: number; skipped?: number; message?: string};
  history: {at: string; found: number; saved: number; prepared?: number; skipped?: number}[];
};
async function request(action: string, data?: unknown): Promise<PilotState> {
  const response = await fetch('/api/autopilot/' + action, data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Не удалось сохранить настройки автопилота');
  return result;
}

export function AutopilotPanel() {
  const saved = savedConfig();
  const [source,setSource]=useState<Source>(()=>saved.source || 'recommendations');
  const [query, setQuery] = useState<string>(()=>saved.query || 'Fullstack Python разработчик');
  const [interval, setInterval] = useState<number>(()=>saved.interval_minutes || 30);
  const [prepareDrafts,setPrepareDrafts]=useState<boolean>(()=>saved.auto_apply !== false);
  const [resumeId,setResumeId]=useState<string>(()=>saved.resume_id || '');
  const [dailyLimit,setDailyLimit]=useState<number>(()=>saved.daily_limit || 5);
  const [excludedCompanies,setExcludedCompanies]=useState<string>(()=>saved.excluded_companies || '');
  const [excludedWords,setExcludedWords]=useState<string>(()=>saved.excluded_words || 'qa, тестировщик, стажер, стажёр, senior, lead');
  const [requiredWords,setRequiredWords]=useState<string>(()=>saved.required_words || 'python');
  const [letterInstructions,setLetterInstructions]=useState<string>(()=>saved.letter_instructions || 'Коротко и по делу. Акцент на Python, FastAPI, React и опыте продакшн-разработки.');
  const status = useQuery({queryKey: ['autopilot'], queryFn: () => request('status'), refetchInterval: 3000});
  const hydrated = useRef(false);
  useEffect(()=>{
    if(hydrated.current || !status.data) return;
    hydrated.current=true;
    const data=status.data;
    if(data.source) setSource(data.source);
    if(data.query) setQuery(data.query);
    if(data.interval_minutes) setInterval(data.interval_minutes);
    if(typeof data.auto_apply==='boolean') setPrepareDrafts(data.auto_apply);
    if(data.resume_id) setResumeId(data.resume_id);
    if(data.daily_limit) setDailyLimit(data.daily_limit);
    if(typeof data.excluded_companies==='string') setExcludedCompanies(data.excluded_companies);
    if(typeof data.excluded_words==='string') setExcludedWords(data.excluded_words);
    if(typeof data.required_words==='string') setRequiredWords(data.required_words);
    if(typeof data.letter_instructions==='string') setLetterInstructions(data.letter_instructions);
  },[status.data]);
  const resumes=useQuery({queryKey:['resumes'],queryFn:async()=>{const response=await fetch('/api/resumes');if(!response.ok)throw Error('Не удалось загрузить резюме');return response.json();}});
  const start = useMutation({mutationFn: () => {
    const config={source,query,interval_minutes:interval,auto_apply:prepareDrafts,resume_id:resumeId||null,prepare_only:true,daily_limit:dailyLimit,excluded_companies:excludedCompanies,excluded_words:excludedWords,required_words:requiredWords,letter_instructions:letterInstructions};
    localStorage.setItem('jobghost-pilot-config',JSON.stringify(config));
    return request('start',config);
  }, onSuccess: () => status.refetch()});
  const pause = useMutation({mutationFn: () => request('pause', {}), onSuccess: () => status.refetch()});
  const labels: Record<string, string> = {paused: 'Остановлен', starting: 'Запускается', running: 'Проверяет вакансии', waiting: 'Работает в фоне', needs_attention: 'Нужно ваше действие'};
  const activeResumeCount=resumes.data?.filter((resume:{is_active:boolean;hh_resume_id?:string})=>resume.is_active&&resume.hh_resume_id).length || 0;
  const canStart=Boolean(resumeId && (source==='recommendations'||query.trim()) && !status.data?.enabled && !start.isPending);
  const history=status.data?.history || [];
  return <section className="panel autopilot-panel">
    <div className="section-heading"><div><span className="step-number">2</span><div><h2>Настройте безопасный автопилот</h2><p>JobGhost найдёт вакансии и подготовит письма. <b>Отправка работодателю — только после вашей проверки.</b></p></div></div><span className={status.data?.enabled?'state-pill state-ok':'state-pill'}>{labels[status.data?.status || ''] || 'Проверка…'}</span></div>
    <div className="setup-grid">
      <fieldset disabled={status.data?.enabled} className="choice-group">
        <legend>Откуда брать вакансии</legend>
        <label className={source==='recommendations'?'choice-card selected':'choice-card'}><input type="radio" name="pilot-source" checked={source==='recommendations'} onChange={()=>setSource('recommendations')}/><span><b>Подходящие от HH</b><small>Рекомендации HH для выбранного резюме</small></span><em>Советуем</em></label>
        <label className={source==='search'?'choice-card selected':'choice-card'}><input type="radio" name="pilot-source" checked={source==='search'} onChange={()=>setSource('search')}/><span><b>По моему запросу</b><small>Обычный поиск по заданной фразе</small></span></label>
      </fieldset>
      <div className="setup-fields">
        <label><span>Резюме HH</span><select aria-label="Резюме для автопилота" value={resumeId} disabled={status.data?.enabled} onChange={e=>setResumeId(e.target.value)}><option value="">Выберите резюме</option>{resumes.data?.filter((resume:{is_active:boolean;hh_resume_id?:string})=>resume.is_active&&resume.hh_resume_id).map((resume:{id:string;name:string})=><option value={resume.id} key={resume.id}>{resume.name}</option>)}</select><small>{activeResumeCount ? 'Будет использовано именно это резюме.' : 'Сначала нажмите «Обновить резюме» в шаге 1.'}</small></label>
        {source==='search'&&<label><span>Что искать</span><input aria-label="Запрос фонового поиска" value={query} onChange={e => setQuery(e.target.value)}/></label>}
        <label><span>Обязательные слова</span><input aria-label="Обязательные слова вакансии" value={requiredWords} onChange={e=>setRequiredWords(e.target.value)} placeholder="python"/><small>Все слова через запятую должны быть в полном описании.</small></label>
      </div>
    </div>
    <label className="settings-toggle primary-toggle"><input type="checkbox" checked={prepareDrafts} disabled={status.data?.enabled} onChange={e=>setPrepareDrafts(e.target.checked)}/><span><b>Автоматически готовить сопроводительные письма</b><small>Письмо появится в разделе «Отклики и письма». JobGhost не нажимает финальную кнопку HH.</small></span></label>
    <details className="advanced-settings"><summary>Дополнительные настройки</summary><div className="advanced-grid">
      <label>Проверять каждые, минут<input aria-label="Интервал фонового поиска" type="number" min={5} max={1440} value={interval} onChange={e=>setInterval(Number(e.target.value))}/></label>
      <label>Максимум черновиков за 24 часа<input type="number" min={1} max={50} value={dailyLimit} onChange={e=>setDailyLimit(Number(e.target.value))}/></label>
      <label className="wide">Не рассматривать вакансии со словами<input maxLength={2000} value={excludedWords} onChange={e=>setExcludedWords(e.target.value)}/><small>Через запятую. Проверяется заголовок и полное описание.</small></label>
      <label className="wide">Не рассматривать компании<input maxLength={2000} value={excludedCompanies} onChange={e=>setExcludedCompanies(e.target.value)} placeholder="Через запятую"/></label>
      <label className="wide">Как писать сопроводительное письмо<textarea maxLength={2000} rows={3} value={letterInstructions} onChange={e=>setLetterInstructions(e.target.value)}/><small>Это только стиль. Факты берутся из резюме и вакансии.</small></label>
    </div></details>
    {(status.data?.error || start.error || pause.error || status.error) && <div className="action-alert" role="alert"><b>Автопилот остановлен</b><span>{status.data?.error || start.error?.message || pause.error?.message || status.error?.message}</span></div>}
    <div className="pilot-actions"><button disabled={!canStart} onClick={() => start.mutate()}>{start.isPending?'Запускаю…':'Запустить автопилот'}</button><button className="secondary" disabled={pause.isPending || !status.data?.enabled} onClick={() => pause.mutate()}>Остановить</button><small>Без скрытых отправок. Каждый реальный отклик подтверждается отдельно.</small></div>
    {status.data?.next_run && <p className="muted">Следующая проверка: {new Date(status.data.next_run).toLocaleString('ru-RU')}</p>}
    {status.data?.result?.message&&<p role="status">{status.data.result.message}</p>}
    {history.length>0&&<details className="pilot-history"><summary>Последние проверки</summary>{history.slice(-3).reverse().map(h => <p key={h.at}>{new Date(h.at).toLocaleString('ru-RU')}: найдено {h.found}, новых {h.saved}, черновиков {h.prepared||0}, пропущено {h.skipped||0}</p>)}</details>}
  </section>;
}
