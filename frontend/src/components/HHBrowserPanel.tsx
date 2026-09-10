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
  return <section className="panel" style={{padding: 20, marginBottom: 20}}>
    <h2>HH — обычный браузер, без API</h2>
    <p>Войдите в отдельном окне Microsoft Edge. Вход сохраняется локально. Пароль и SMS вводите только на HH.</p>
    <p role="status">{status.data?.message || 'Проверка подключения…'}</p>
    <div className="toolbar">
      <button disabled={busy} onClick={() => open.mutate()}>Открыть вход в HH</button>
      <button className="secondary" disabled={busy} onClick={() => status.refetch()}>Я вошёл — проверить</button>
      <button className="secondary" disabled={busy} onClick={() => resumes.mutate()}>Прочитать мои резюме</button>
      <input aria-label="Запрос поиска HH" value={query} onChange={e => setQuery(e.target.value)} maxLength={200}/>
      <button disabled={busy || !query.trim()} onClick={() => search.mutate()}>{search.isPending ? 'Читаю HH…' : 'Найти на HH'}</button>
    </div>
    <p>Читается одна страница результатов. Отклики не отправляются. Зарплату и полное описание проверяйте на HH.</p>
    {search.data && <p role="status">{search.data.message}</p>}
    {resumes.data && <div role="status"><p>{resumes.data.message}</p>{resumes.data.resumes.map((r: {id: string; name: string}) => <p key={r.id}>{r.name}</p>)}</div>}
    {resumes.error && <p role="alert">{resumes.error.message}</p>}
    {(open.error || search.error || status.error) && <p role="alert">{(open.error || search.error || status.error)?.message}</p>}
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
