import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';

async function hhRequest(path: string, body?: unknown) {
  const response = await fetch('/api/hh-browser' + path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'Ошибка подключения HH');
  return data;
}

export function HHBrowserPanel() {
  const [query, setQuery] = useState('Python');
  const qc = useQueryClient();
  const status = useQuery({queryKey: ['hh-browser'], queryFn: () => hhRequest('/status'), refetchInterval: 5000});
  const open = useMutation({mutationFn: () => hhRequest('/open', {}), onSuccess: () => qc.invalidateQueries({queryKey: ['hh-browser']})});
  const search = useMutation({mutationFn: () => hhRequest('/search', {query}), onSuccess: () => qc.invalidateQueries({queryKey: ['vacancies']})});
  const resumes = useMutation({mutationFn: () => hhRequest('/resumes/import', {})});
  const busy = open.isPending || search.isPending || resumes.isPending;
  const connected=status.data?.state==='connected';
  return <section className="panel hh-connect-panel">
    <div className="section-heading"><div><span className="step-number">1</span><div><h2>Подключите HH</h2><p>Вход хранится только в локальном браузере JobGhost.</p></div></div><span className={connected?'state-pill state-ok':'state-pill'}>{connected?'HH подключён':status.data?.message || 'Проверка…'}</span></div>
    <div className="pilot-actions">
      <button disabled={busy} onClick={() => open.mutate()}>{connected?'Открыть HH':'Открыть HH и войти'}</button>
      <button className="secondary" disabled={busy} onClick={() => status.refetch()}>Проверить вход</button>
      <button className="secondary" disabled={busy || !connected} onClick={() => resumes.mutate()}>{resumes.isPending?'Читаю…':'Обновить резюме'}</button>
    </div>
    <small>Пароль, SMS и капчу вводите только на hh.ru. JobGhost не хранит их и не обходит проверки.</small>
    <details className="advanced-settings"><summary>Разовый поиск вручную</summary><div className="toolbar"><input aria-label="Запрос поиска HH" value={query} onChange={e => setQuery(e.target.value)} maxLength={200}/><button disabled={busy || !query.trim() || !connected} onClick={() => search.mutate()}>{search.isPending ? 'Читаю HH…' : 'Найти вакансии'}</button></div><small>Только читает одну страницу выдачи. Отклики не отправляются.</small></details>
    {search.data && <p role="status">{search.data.message}</p>}
    {resumes.data && <div role="status"><p>{resumes.data.message}</p>{resumes.data.resumes.map((r: {id: string; name: string}) => <p key={r.id}>{r.name}</p>)}</div>}
    {resumes.error && <p role="alert">{resumes.error.message}</p>}
    {(open.error || search.error || status.error) && <div className="action-alert" role="alert"><b>Не удалось подключиться к HH</b><span>{(open.error || search.error || status.error)?.message}</span></div>}
  </section>;
}

export function OpenHHVacancy({id}: {id: string}) {
  const open = useMutation({mutationFn: () => hhRequest(`/vacancies/${id}/open`, {})});
  return <><button disabled={open.isPending} onClick={() => open.mutate()}>Открыть в браузере HH</button>{open.error && <p role="alert">{open.error.message}</p>}</>;
}

export function ReadHHVacancy({id}: {id: string}) {
  const qc = useQueryClient();
  const read = useMutation({mutationFn: () => hhRequest(`/vacancies/${id}/read`, {}), onSuccess:()=>qc.invalidateQueries({queryKey:['vacancies']})});
  return <div><button disabled={read.isPending} onClick={()=>read.mutate()}>{read.isPending ? 'Читаю описание…' : 'Прочитать полное описание HH'}</button>{read.error && <p role="alert">{read.error.message}</p>}{read.data && <div><p>Прочитано {read.data.characters} символов. Сохранено для подготовки письма.</p><p style={{whiteSpace:'pre-line'}}>{read.data.description}</p></div>}</div>;
}
