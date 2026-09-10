import {providerLabel} from '../labels';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Search, X} from 'lucide-react';
import {api, type Vacancy} from '../api/client';
import {VacancyCard} from '../components/VacancyCard';
import {HHBrowserPanel, OpenHHVacancy, ReadHHVacancy} from '../components/HHBrowserPanel';
import {AutopilotPanel} from '../components/AutopilotPanel';
import {ApplicationDraft} from '../components/ApplicationDraft';

export function Vacancies() {
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Vacancy|null>(null);
  const {data = [], error} = useQuery({queryKey: ['vacancies'], queryFn: api.vacancies});
  const visible = data.filter(v => (v.title + v.company).toLowerCase().includes(term.toLowerCase()));
  return <>
    <header><div><span className="eyebrow">ВОЗМОЖНОСТИ</span><h1>Вакансии</h1><p>Реальные результаты HH и ранее сохранённые вакансии.</p></div></header>
    <HHBrowserPanel/>
    <AutopilotPanel/>
    <div className="toolbar"><label><Search/><input value={term} onChange={e => setTerm(e.target.value)} placeholder="Фильтр сохранённых вакансий"/></label><span>{visible.length} вакансий</span></div>
    {error && <p role="alert">{error.message}</p>}
    <section className="vacancy-grid">{visible.map(v => <VacancyCard key={v.id} item={v} onOpen={setSelected}/>)}</section>
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal" onClick={e => e.stopPropagation()}>
      <button className="close" aria-label="Закрыть вакансию" onClick={() => setSelected(null)}><X/></button>
      <span className="eyebrow">{providerLabel(selected.provider)}</span><h1>{selected.title}</h1><h3>{selected.company}</h3>
      {selected.provider === 'hh_browser' && <><p>Краткая карточка из поиска HH. Полное описание доступно в браузере.</p><OpenHHVacancy id={selected.id}/></>}
      <p style={{whiteSpace: 'pre-line'}}>{selected.description}</p>
      <ApplicationDraft vacancyId={selected.id}/>
      {selected.provider === 'hh_browser' && <ReadHHVacancy key={selected.id} id={selected.id}/>}
      {selected.requirements && <><h3>Требования</h3><p>{selected.requirements}</p></>}
      {selected.responsibilities && <><h3>Обязанности</h3><p>{selected.responsibilities}</p></>}
    </div></div>}
  </>;
}
