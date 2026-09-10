import {useEffect, useRef, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ChatAnswer} from './ChatAnswer';
import {ChatPairing} from './ChatPairing';
import {SerialWorkQueue} from './SerialWorkQueue';
import {speechLabel} from '../labels';

type CaptureStream={stream:MediaStream;source:string;recording:boolean};

export function InterviewCapture() {
  const video = useRef<HTMLVideoElement>(null);
  const streams = useRef<CaptureStream[]>([]);
  const audio = useRef<AudioContext|null>(null);
  const meter = useRef<ReturnType<typeof setInterval>|null>(null);
  const [screen, setScreen] = useState(false);
  const [mic, setMic] = useState(false);
  const [systemAudio, setSystemAudio] = useState(false);
  useEffect(()=>{void window.jobghostDesktop?.setCapture?.(screen || mic).catch(()=>{});},[screen,mic]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const [resumeId,setResumeId]=useState(()=>localStorage.getItem('jobghost-interview-resume')||'');
  const [roleReady,setRoleReady]=useState('');
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const recorders = useRef<MediaRecorder[]>([]);
  const recordCurrent = useRef<(stream:MediaStream,source:string)=>void>(()=>{});
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const epoch = useRef(0);
  const [speechQueue]=useState(()=>new SerialWorkQueue(4));
  const [queued,setQueued]=useState(0);
  const [dropped,setDropped]=useState(0);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const speechLoadRequested=useRef(false);
  const transcriptSequence=useRef(0);
  const [transcript, setTranscript] = useState<{id:number;text:string;source:string;question:boolean;language:string}[]>([]);
  const speechStatus = useQuery({queryKey:['speech'], queryFn:async () => {
    const response = await fetch('/api/speech/status');
    if (!response.ok) throw new Error('Сервис речи недоступен');
    return response.json();
  }, refetchInterval:3000});
  const resumes=useQuery({queryKey:['resumes'],queryFn:async()=>{
    const response=await fetch('/api/resumes');
    if(!response.ok)throw Error('Не удалось загрузить резюме');
    return response.json() as Promise<{id:string;name:string;hh_resume_id?:string;is_active:boolean}[]>;
  }});
  useEffect(()=>{
    if(!resumes.data?.length)return;
    const available=resumes.data.filter(item=>item.is_active);
    if(available.some(item=>item.id===resumeId))return;
    const preferred=available.find(item=>item.hh_resume_id)||available[0];
    if(preferred){setResumeId(preferred.id);localStorage.setItem('jobghost-interview-resume',preferred.id);}
  },[resumes.data,resumeId]);
  useEffect(()=>{
    if(speechStatus.data?.state!=='not_loaded'||speechLoadRequested.current)return;
    speechLoadRequested.current=true;
    void fetch('/api/speech/load',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(()=>speechStatus.refetch()).catch(()=>setError('Не удалось подготовить локальное распознавание речи'));
  },[speechStatus]);

  async function sendAudio(blob: Blob, source: string, generation: number) {
    if (generation !== epoch.current || !blob.size) return;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if(generation!==epoch.current) return;
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await fetch('/api/speech/transcribe', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({audio:btoa(binary)})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Ошибка распознавания');
      if (generation === epoch.current && result.text) setTranscript(t => [...t, {id:++transcriptSequence.current,text:result.text, source, question:result.is_question,language:result.language||'auto'}].slice(-30));
    } catch (e) {if(generation === epoch.current) setError(e instanceof Error ? e.message : 'Ошибка речи');}
  }
  useEffect(()=>{
    speechQueue.onChange=setQueued;
    speechQueue.onError=()=>setError('Ошибка очереди распознавания');
    return ()=>{speechQueue.onChange=undefined;speechQueue.onError=undefined;speechQueue.clear();};
  },[speechQueue]);

  function record(stream: MediaStream, source: string) {
    if (!speechEnabled || speechStatus.data?.state !== 'ready' || !stream.getAudioTracks().length) return;
    const generation = epoch.current;
    const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
    recorders.current.push(recorder);
    recorder.ondataavailable = event => {
      if(generation!==epoch.current || !event.data.size) return;
      if(!speechQueue.enqueue(()=>sendAudio(event.data,source,generation))) {
        setDropped(value=>value+1);
        setError('Очередь речи заполнена: фрагмент пропущен. Отключите лишний аудиоисточник или остановите захват.');
      }
    };
    recorder.onstop = () => {if (generation === epoch.current && stream.getAudioTracks().some(t=>t.readyState === 'live')) recorder.start();};
    recorder.start();
    timers.current.push(setInterval(() => {if(recorder.state === 'recording') recorder.stop();}, 6000));
  }
  recordCurrent.current=record;
  useEffect(()=>{
    if(!speechEnabled||speechStatus.data?.state!=='ready')return;
    streams.current.forEach(item=>{
      if(!item.recording&&item.stream.getAudioTracks().some(track=>track.readyState==='live')){
        recordCurrent.current(item.stream,item.source);item.recording=true;
      }
    });
  },[speechEnabled,speechStatus.data?.state]);

  function stop() {
    epoch.current++;
    speechQueue.clear();
    timers.current.forEach(clearInterval); timers.current = [];
    recorders.current.forEach(r => {if(r.state !== 'inactive') r.stop();}); recorders.current = [];
    streams.current.forEach(item => item.stream.getTracks().forEach(track => track.stop()));
    streams.current = [];
    if (meter.current) clearInterval(meter.current);
    if (audio.current) void audio.current.close();
    audio.current = null;
    if (video.current) video.current.srcObject = null;
    setScreen(false); setMic(false); setSystemAudio(false); setLevel(0);
  }
  useEffect(() => () => {
    epoch.current++;
    speechQueue.clear();
    timers.current.forEach(clearInterval);
    recorders.current.forEach(r => {if(r.state !== 'inactive') r.stop();});
    streams.current.forEach(item => item.stream.getTracks().forEach(t => t.stop()));
    if (meter.current) clearInterval(meter.current);
    if (audio.current) void audio.current.close();
  }, [speechQueue]);

  async function capture(display: boolean):Promise<boolean> {
    setBusy(true); setError('');
    const generation=epoch.current;
    try {
      const stream = display
        ? await navigator.mediaDevices.getDisplayMedia({video: {frameRate: 5}, audio: true})
        : await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      if(generation!==epoch.current) {
        stream.getTracks().forEach(track=>track.stop());
        return false;
      }
      const item:CaptureStream={stream,source:display?'Системный звук':'Микрофон',recording:false};
      streams.current.push(item);
      if(speechEnabled&&speechStatus.data?.state==='ready'){record(stream,item.source);item.recording=true;}
      stream.getTracks().forEach(t => t.addEventListener('ended', stop, {once: true}));
      if (display) {
        setScreen(true); setSystemAudio(stream.getAudioTracks().length > 0);
        if (video.current) {video.current.srcObject = stream; await video.current.play();}
      } else setMic(true);
      if (stream.getAudioTracks().length) {
        const context = audio.current || new AudioContext(); audio.current = context;
        await context.resume();
        const analyser = context.createAnalyser(); analyser.fftSize = 1024;
        context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        if (meter.current) clearInterval(meter.current);
        meter.current = setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, n) => sum + ((n-128)/128)**2, 0) / samples.length);
          setLevel(Math.min(100, Math.round(rms * 300)));
        }, 100);
      }
      return true;
    } catch (e) {setError(e instanceof Error ? e.message : 'Не удалось включить захват');return false;}
    finally {setBusy(false);}
  }

  async function startSession(){
    setError('');
    setRoleReady('');
    if(!resumeId){setError('Сначала выберите резюме для роли ChatGPT в настройках.');return {screen:false,mic:false};}
    const roleResponse=await fetch('/api/chat-browser/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resume_id:resumeId})});
    const role=await roleResponse.json();
    if(!roleResponse.ok){setError(typeof role.detail==='string'?role.detail:'Не удалось загрузить роль по резюме');return {screen:false,mic:false};}
    setRoleReady(`Роль загружена: ${role.resume}`);
    const hasScreen=screen||await capture(true);
    if(!hasScreen)return {screen:false,mic:false};
    const hasMic=mic||await capture(false);
    return {screen:true,mic:hasMic};
  }

  function currentSnapshot() {
    if (!video.current?.videoWidth || !streams.current.some(item=>item.stream.getVideoTracks().some(track=>track.readyState==='live'))) throw Error('Сначала выберите экран для захвата. Снимок не сделан.');
    const canvas = document.createElement('canvas');
    const scale=Math.min(1,1920/video.current.videoWidth,1080/video.current.videoHeight);
    canvas.width = Math.max(1,Math.round(video.current.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.current.videoHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw Error('Не удалось создать снимок экрана');
    context.drawImage(video.current, 0, 0,canvas.width,canvas.height);
    const value=canvas.toDataURL('image/jpeg',0.85);
    if(value.length>4000000)throw Error('Снимок слишком большой. Выберите отдельное окно меньшего размера.');
    setSnapshot(value);return value;
  }
  function takeSnapshot(){try{currentSnapshot();setError('');}catch(e){setError(e instanceof Error?e.message:'Не удалось сделать снимок');}}
  async function chooseRegionSnapshot() {
    if(screen)return currentSnapshot();
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    try{
      const frame=document.createElement('video');frame.muted=true;frame.srcObject=stream;await frame.play();
      if(!frame.videoWidth)throw Error('Изображение экрана ещё не готово. Попробуйте выбрать источник снова.');
      const canvas=document.createElement('canvas');canvas.width=frame.videoWidth;canvas.height=frame.videoHeight;
      const context=canvas.getContext('2d');if(!context)throw Error('Не удалось получить снимок');
      context.drawImage(frame,0,0);return canvas.toDataURL('image/jpeg',0.92);
    }finally{stream.getTracks().forEach(track=>track.stop());}
  }
  useEffect(()=>window.jobghostDesktop?.onAction(action=>{
    if(action==='snapshot') takeSnapshot();
    if(action==='stop') stop();
  }));

  const latestVoice=transcript.at(-1);
  return <ChatAnswer latestQuestion={latestVoice?.text || ''} latestQuestionKey={latestVoice?.id} latestQuestionSource={latestVoice?`${latestVoice.source} · ${latestVoice.language.toUpperCase()}`:undefined} latestQuestionDetected={latestVoice?.question} snapshot={snapshot} getSnapshot={currentSnapshot} onChooseRegion={chooseRegionSnapshot} onStartSession={startSession} sessionActive={screen||mic} onStop={stop} onSnapshot={takeSnapshot} captureStatus={`Экран: ${screen ? 'ВКЛ' : 'выкл'} · Микрофон: ${mic ? 'ВКЛ' : 'выкл'} · Системный звук: ${systemAudio ? 'ВКЛ' : 'выкл'}${snapshot ? ' · Снимок готов' : ''}${error ? ' · '+error : ''}`} connectionContent={<ChatPairing/>} settingsContent={<>
    <h2>Роль ChatGPT</h2>
    <label>Резюме для ответов <select aria-label="Резюме для роли ChatGPT" value={resumeId} disabled={screen||mic} onChange={event=>{setResumeId(event.target.value);localStorage.setItem('jobghost-interview-resume',event.target.value);setRoleReady('');}}><option value="">Выберите резюме</option>{resumes.data?.filter(item=>item.is_active).map(item=><option key={item.id} value={item.id}>{item.name}{item.hh_resume_id?' · HH':''}</option>)}</select></label>
    <p>При каждом запуске сессии ChatGPT получает профессиональный контекст выбранного резюме. Контакты исключаются, а выдумывать опыт запрещено.</p>
    {roleReady&&<p role="status">{roleReady}</p>}
    <h2>Экран и звук</h2>
    <p>Включайте захват с согласия участников. Аудио распознаётся локально. Текст передаётся в ChatGPT только после подключения моста и включения отправки вопросов ниже.</p>
    <div className="toolbar">
      <button disabled={busy || screen} onClick={() => capture(true)}>Выбрать экран и системный звук</button>
      <button disabled={busy || mic} onClick={() => capture(false)}>Включить микрофон</button>
      <button disabled={busy} className="secondary" onClick={stop}>Остановить весь захват</button>
    </div>
    <p role="status">Экран: {screen ? 'ЗАХВАТ ВКЛЮЧЁН' : 'выключен'} · Микрофон: {mic ? 'ВКЛЮЧЁН' : 'выключен'} · Системный звук: {systemAudio ? 'ВКЛЮЧЁН' : 'не захватывается'}</p>
    <label>Уровень последнего подключённого аудиоисточника <meter min={0} max={100} value={level}/></label>
    {error && <p role="alert">{error}</p>}
    <video ref={video} muted autoPlay playsInline style={{display: screen ? 'block' : 'none', width: '100%', maxHeight: 360, background: '#000'}}/>
    <button disabled={!screen} onClick={takeSnapshot}>Сделать снимок для вопроса</button>
    {snapshot && <div><img src={snapshot} alt="Выбранный снимок экрана" style={{maxWidth:'100%',maxHeight:300}}/><p><a download="jobghost-screen.jpg" href={snapshot}>Сохранить снимок</a> <button className="secondary" onClick={() => setSnapshot('')}>Удалить снимок</button></p></div>}
    <h3>Локальное распознавание речи</h3>
    <p>{speechLabel(speechStatus.data?.state)} · русский и English определяются автоматически. {speechStatus.data?.error || speechStatus.error?.message || ''}</p>
    <button disabled={speechStatus.data?.state === 'loading' || speechStatus.data?.state === 'ready'} onClick={async () => {
      await fetch('/api/speech/load', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}); await speechStatus.refetch();
    }}>Загрузить модель речи на компьютер</button>
    <label><input type="checkbox" checked={speechEnabled} disabled={screen || mic} onChange={e=>setSpeechEnabled(e.target.checked)}/> Распознавать при следующем включении захвата</label>
    <p>После загрузки модели включите захват заново. Фрагменты по 6 секунд обрабатываются локально. Вопросы определяются автоматически; последнюю фразу всегда можно отправить вручную через Ctrl+Enter.</p>
    <p role="status">Фрагментов в обработке и очереди: {queued}. Пропущено из-за перегрузки: {dropped}.</p>
    {transcript.map(t => <p key={t.id}><small>{t.source} · {t.language.toUpperCase()}{t.question ? ' · вопрос' : ' · речь'}</small><br/>{t.text}</p>)}
    <button className="secondary" onClick={()=>setTranscript([])}>Очистить текст</button>
    </>}/>;
}
