import {statusLabel} from '../labels';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '../api/client';
import {LetterEditor} from '../components/ApplicationDraft';
export function Applications(){
  const [selected,setSelected] = useState('');
  const {data=[],error} = useQuery({queryKey:['applications'],queryFn:api.applications});
  const vacancies = useQuery({queryKey:['vacancies'],queryFn:api.vacancies});
  return <><header><div><h1>Отклики и письма</h1><p>Черновики не являются отправленными откликами.</p></div></header>
    {error && <p role="alert">{error.message}</p>}
    {!data.length && <p>Выберите вакансию и создайте черновик с вашим резюме.</p>}
    {data.map(a=><article className="panel" style={{padding:16,marginBottom:12}} key={a.id}>
      <h3>{vacancies.data?.find(v=>v.id===a.vacancy_id)?.title || a.vacancy_id}</h3>
      <p>{statusLabel(a.status)} · {a.dry_run ? 'Тестовый режим' : 'Реальный режим'}</p>
      {!['APPLIED','SENDING','NEEDS_REVIEW'].includes(a.status) && <button onClick={()=>setSelected(selected===a.id?'':a.id)}>Письмо и данные отклика</button>}
      {a.status === 'NEEDS_REVIEW' && <p role="alert">Проверьте отклик в личном кабинете HH. Программа не подтверждает доставку выбранного резюме и письма и не отправит их повторно.</p>}
      {selected===a.id && <LetterEditor key={a.id} id={a.id}/>}
    </article>)}
  </>;
}
