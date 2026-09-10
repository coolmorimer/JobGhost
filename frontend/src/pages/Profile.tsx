import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {api} from '../api/client';
const fields=[['name','Ваше имя','text'],['location','Город','text'],['minimum_salary','Минимальная зарплата, ₽','number'],['desired_salary','Желаемая зарплата, ₽','number'],['desired_roles','Какие должности ищете','list'],['excluded_roles','Какие должности исключить','list'],['employment_types','Типы занятости','list'],['strengths','Сильные стороны','list'],['blacklisted_companies','Исключить компании','list'],['blacklisted_keywords','Исключить слова в вакансиях','list'],['skills','Навыки и уровень','map'],['languages','Языки и уровень','map'],['links','Ссылки на ваши работы','map']] as const;
export function Profile(){
  const {data,error}=useQuery({queryKey:['profile'],queryFn:api.profile});
  const [edits,setEdits]=useState<Record<string,string|boolean>>({});
  const save=useMutation({mutationFn:()=>{
    const result={...data};delete result.id;
    for(const [key,,type] of fields){if(!(key in edits))continue;const value=String(edits[key]);
      if(type==='number'){if(value && (!Number.isFinite(Number(value)) || Number(value)<0))throw Error('Зарплата должна быть положительным числом');result[key]=value===''?null:Number(value);}
      else if(type==='list')result[key]=value.split('\n').map(x=>x.trim()).filter(Boolean);
      else if(type==='map'){const rows=value.split('\n').filter(x=>x.trim());result[key]=Object.fromEntries(rows.map(row=>{const split=row.indexOf(':');if(split<1)throw Error('Для навыков, языков и ссылок используйте формат «название: значение»');return [row.slice(0,split).trim(),row.slice(split+1).trim()];}));}
      else result[key]=value;
    }
    for(const key of ['remote','relocation'])if(key in edits)result[key]=edits[key];
    return api.saveProfile(result);
  }});
  return <><header><div><span className="eyebrow">О ВАС</span><h1>Мой профиль</h1><p>Укажите условия поиска. Импортированные резюме выбираются отдельно при подготовке отклика.</p></div></header>
    {error && <p role="alert">Не удалось загрузить профиль: {error.message}</p>}
    {!data ? <p>Загружаем профиль…</p> : <form className="panel profile-form" onSubmit={event=>{event.preventDefault();save.mutate();}}>
      {fields.map(([key,label,type])=>{const existing=data[key];const fallback=type==='list'&&Array.isArray(existing)?existing.join('\n'):type==='map'&&existing&&typeof existing==='object'?Object.entries(existing).map(([k,v])=>`${k}: ${v}`).join('\n'):String(existing??'');
        return <label key={key}>{label}{type==='list'||type==='map'?<><textarea value={String(edits[key]??fallback)} onChange={e=>setEdits({...edits,[key]:e.target.value})}/><small>{type==='list'?'Каждый пункт с новой строки':'Каждая строка: название: значение'}</small></>:<input type={type} min={type==='number'?0:undefined} value={String(edits[key]??fallback)} onChange={e=>setEdits({...edits,[key]:e.target.value})}/>}</label>;
      })}
      <label><span><input type="checkbox" checked={Boolean(edits.remote??data.remote)} onChange={e=>setEdits({...edits,remote:e.target.checked})}/>Хочу работать удалённо</span></label>
      <label><span><input type="checkbox" checked={Boolean(edits.relocation??data.relocation)} onChange={e=>setEdits({...edits,relocation:e.target.checked})}/>Готов к переезду</span></label>
      <div className="wide"><p>Опыт, образование, проекты и дополнительные настройки сохраняются без изменения.</p><button disabled={save.isPending} type="submit">{save.isPending?'Сохраняем…':'Сохранить профиль'}</button>{save.isSuccess&&<p role="status">Профиль сохранён</p>}{save.error&&<p role="alert">{save.error.message}</p>}</div>
    </form>}
  </>;
}
