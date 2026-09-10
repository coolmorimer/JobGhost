import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
export function DesktopControls(){
  const [error,setError]=useState('');
  const status=useQuery({queryKey:['chat-browser'],queryFn:async()=>{const r=await fetch('/api/chat-browser/status');if(!r.ok)throw Error('Нет связи с приложением');return r.json();},refetchInterval:5000});
  return <div className="desktop-bar"><span className={status.data?.state==='ready'?'connected':'disconnected'}>ChatGPT: {status.data?.state==='ready'?'подключён':status.error?'нет связи':'не подключён'}</span><button className="secondary" disabled={!window.jobghostDesktop?.hide} onClick={async()=>{try{await window.jobghostDesktop?.hide?.();}catch{setError('Не удалось скрыть окно. Перезапустите приложение.');}}}>Скрыть окно</button>{!window.jobghostDesktop?.hide && <small>Управление окном доступно в десктопном приложении</small>}{error && <span role="alert">{error}</span>}</div>;
}
