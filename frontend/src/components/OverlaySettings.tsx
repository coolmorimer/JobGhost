import {useEffect,useState} from 'react';
export function OverlaySettings(){
  const [opacity,setOpacity]=useState(85),[pass,setPass]=useState(true),[protection,setProtection]=useState(true),[error,setError]=useState('');
  const [shortcut,setShortcut]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{
      try{const state=await window.jobghostDesktop?.getState();if(active&&state?.overlay){setOpacity(Math.round(state.overlay.opacity*100));setPass(state.overlay.passthrough);setProtection(state.overlay.protection ?? state.overlay.protected);setShortcut(state.pointerShortcut?.replace('Control','Ctrl') || null);}}
      catch{if(active)setError('Не удалось прочитать настройки окна');}
    };
    void refresh();const timer=setInterval(()=>void refresh(),500);
    return ()=>{active=false;clearInterval(timer);};
  },[]);
  async function change(options:{opacity?:number;passthrough?:boolean;protection?:boolean}){
    try{if(!window.jobghostDesktop?.setOverlay)throw Error('Перезапустите десктопное приложение');const result=await window.jobghostDesktop.setOverlay(options);setOpacity(Math.round(result.opacity*100));setPass(result.passthrough);setProtection(result.protection ?? result.protected);setError('');}
    catch(e){setError(e instanceof Error?e.message:'Не удалось изменить настройки');}
  }
  return <div className="overlay-settings">
    <label><span>Прозрачность чата</span><b>{100-opacity}%</b><input aria-label="Прозрачность чата" type="range" min={0} max={75} value={100-opacity} onChange={e=>void change({opacity:1-Number(e.target.value)/100})}/></label>
    <label className="settings-toggle"><input type="checkbox" checked={pass} onChange={e=>void change({passthrough:e.target.checked})}/><span><b>Клики насквозь</b><small>Удерживайте Shift, чтобы временно нажимать кнопки чата.</small></span></label>
    <label className="settings-toggle"><input aria-label="Защита окна от записи" type="checkbox" checked={protection} onChange={e=>void change({protection:e.target.checked})}/><span><b>Защита окна от записи</b><small>{protection?'Окно скрывается от поддерживаемой записи и демонстрации экрана.':'Окно может попасть в запись или демонстрацию.'}</small></span></label>
    <p>{shortcut?`${shortcut} — быстро включить или выключить клики насквозь.`:'Горячая клавиша кликов недоступна. Удерживайте Shift для управления чатом.'}</p>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
