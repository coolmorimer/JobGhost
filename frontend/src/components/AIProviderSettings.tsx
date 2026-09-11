import {useEffect, useState, type ReactNode} from 'react';

type Provider='browser'|'openai'|'openrouter';
type ModelOption={id:string;name:string};
type AISettings={
  provider:Provider;
  openai_model:string;
  openrouter_model:string;
  openai_key_saved:boolean;
  openrouter_key_saved:boolean;
  openai_models:ModelOption[];
};

async function jsonRequest(path:string, init?:RequestInit) {
  const response=await fetch(path,init);
  const data=await response.json();
  if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Не удалось сохранить настройки ИИ');
  return data;
}

export function AIProviderSettings({connectionContent,onSaved}:{connectionContent?:ReactNode;onSaved?:()=>void}){
  const [settings,setSettings]=useState<AISettings>();
  const [freeModels,setFreeModels]=useState<ModelOption[]>([]);
  const [openaiKey,setOpenaiKey]=useState('');
  const [openrouterKey,setOpenrouterKey]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{void jsonRequest('/api/ai/settings').then(setSettings).catch(error=>setMessage(error.message));},[]);
  useEffect(()=>{
    if(settings?.provider!=='openrouter')return;
    void jsonRequest('/api/ai/models/openrouter').then(data=>setFreeModels(data.models||[])).catch(()=>setFreeModels([]));
  },[settings?.provider]);

  function change(patch:Partial<AISettings>){setSettings(current=>current?{...current,...patch}:current);}
  async function save(remove?:'openai'|'openrouter'){
    if(!settings||busy)return;
    setBusy(true);setMessage('');
    try{
      const body={
        provider:settings.provider,
        openai_model:settings.openai_model,
        openrouter_model:settings.openrouter_model,
        ...(openaiKey?{openai_api_key:openaiKey}:{}),
        ...(openrouterKey?{openrouter_api_key:openrouterKey}:{}),
        ...(remove==='openai'?{openai_api_key:''}:{}),
        ...(remove==='openrouter'?{openrouter_api_key:''}:{}),
      };
      const next=await jsonRequest('/api/ai/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      setSettings(next);setOpenaiKey('');setOpenrouterKey('');
      setMessage('Сохранено. Новый канал уже используется для следующих вопросов.');
      onSaved?.();
    }catch(error){setMessage(error instanceof Error?error.message:'Не удалось сохранить настройки ИИ');}
    finally{setBusy(false);}
  }

  if(!settings)return <p role="status">{message||'Загружаю настройки ИИ…'}</p>;
  return <>
    <div className="provider-cards" role="radiogroup" aria-label="Канал ответов">
      <label className={settings.provider==='openrouter'?'active':''}><input type="radio" name="provider" checked={settings.provider==='openrouter'} onChange={()=>change({provider:'openrouter'})}/><span><b>OpenRouter · бесплатно</b><small>Автоматически выбирает самые быстрые доступные бесплатные модели.</small></span></label>
      <label className={settings.provider==='openai'?'active':''}><input type="radio" name="provider" checked={settings.provider==='openai'} onChange={()=>change({provider:'openai'})}/><span><b>OpenAI API · быстро</b><small>Стабильная потоковая выдача с быстрыми моделями. Оплата по тарифам OpenAI.</small></span></label>
      <label className={settings.provider==='browser'?'active':''}><input type="radio" name="provider" checked={settings.provider==='browser'} onChange={()=>change({provider:'browser'})}/><span><b>ChatGPT в Chrome</b><small>Старый режим без API-ключа. Ответ печатается после получения из браузера.</small></span></label>
    </div>
    {settings.provider==='openai'&&<div className="provider-details">
      <label>Быстрая модель<select value={settings.openai_model} onChange={event=>change({openai_model:event.target.value})}>{settings.openai_models.map(model=><option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
      <label>API-ключ OpenAI<input type="password" autoComplete="off" value={openaiKey} onChange={event=>setOpenaiKey(event.target.value)} placeholder={settings.openai_key_saved?'Ключ сохранён · оставьте пустым без изменений':'Вставьте новый ключ'}/></label>
      <small>Ключ хранится в Windows Credential Manager и никогда не возвращается в интерфейс.</small>
      {settings.openai_key_saved&&<button className="ghost" disabled={busy} onClick={()=>void save('openai')}>Удалить сохранённый ключ</button>}
    </div>}
    {settings.provider==='openrouter'&&<div className="provider-details">
      <label>Бесплатная модель<select value={settings.openrouter_model} onChange={event=>change({openrouter_model:event.target.value})}><option value="auto">Авто · 4 самые быстрые с резервом</option><option value="openrouter/free">OpenRouter Free Router</option>{freeModels.map(model=><option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
      <label>API-ключ OpenRouter<input type="password" autoComplete="off" value={openrouterKey} onChange={event=>setOpenrouterKey(event.target.value)} placeholder={settings.openrouter_key_saved?'Ключ сохранён · оставьте пустым без изменений':'Вставьте новый ключ'}/></label>
      <small>В список попадают только модели с нулевой ценой ввода и вывода. Доступность бесплатных моделей меняется у OpenRouter.</small>
      {settings.openrouter_key_saved&&<button className="ghost" disabled={busy} onClick={()=>void save('openrouter')}>Удалить сохранённый ключ</button>}
    </div>}
    {settings.provider==='browser'&&<div className="provider-details">{connectionContent}<p>Расширение использует ваш обычный вошедший аккаунт ChatGPT.</p></div>}
    <button disabled={busy} onClick={()=>void save()}>{busy?'Сохраняю…':'Сохранить и включить'}</button>
    {message&&<p role="status" className="settings-status">{message}</p>}
  </>;
}
