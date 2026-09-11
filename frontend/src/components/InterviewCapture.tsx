import {useEffect, useRef, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ChatAnswer} from './ChatAnswer';
import {ChatPairing} from './ChatPairing';
import {SerialWorkQueue} from './SerialWorkQueue';
import {VoiceUtteranceAssembler} from './VoiceUtteranceAssembler';
import {speechLabel} from '../labels';

type CaptureKind='display'|'mic';
type CaptureStream={stream:MediaStream;source:string;kind:CaptureKind;node?:MediaStreamAudioSourceNode};
type VoiceLine={id:number;text:string;source:string;question:boolean;language:string;complete:boolean};

function savedBoolean(key:string,fallback:boolean){
  const value=localStorage.getItem(key);
  return value===null?fallback:value==='true';
}

export function InterviewCapture() {
  const video = useRef<HTMLVideoElement>(null);
  const streams = useRef<CaptureStream[]>([]);
  const audio = useRef<AudioContext|null>(null);
  const destination=useRef<MediaStreamAudioDestinationNode|null>(null);
  const analyserSource=useRef<MediaStreamAudioSourceNode|null>(null);
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
  const recorder = useRef<MediaRecorder|null>(null);
  const recorderTimer = useRef<ReturnType<typeof setInterval>|null>(null);
  const epoch = useRef(0);
  const [speechQueue]=useState(()=>new SerialWorkQueue(4));
  const [queued,setQueued]=useState(0);
  const [dropped,setDropped]=useState(0);
  const [speechEnabled, setSpeechEnabled] = useState(()=>savedBoolean('jobghost-speech-enabled',true));
  const [speechEngine,setSpeechEngine]=useState<'local'|'openai'>(()=>localStorage.getItem('jobghost-speech-engine')==='openai'?'openai':'local');
  const [wantScreen,setWantScreen]=useState(()=>savedBoolean('jobghost-capture-screen',true));
  const [wantMic,setWantMic]=useState(()=>savedBoolean('jobghost-capture-mic',true));
  const speechLoadRequested=useRef(false);
  const transcriptSequence=useRef(0);
  const assembler=useRef(new VoiceUtteranceAssembler());
  const languageHint=useRef<'ru'|'en'|undefined>(undefined);
  const [latestVoice,setLatestVoice]=useState<VoiceLine>();
  const [transcript, setTranscript] = useState<VoiceLine[]>([]);
  const speechStatus = useQuery({queryKey:['speech'], queryFn:async () => {
    const response = await fetch('/api/speech/status');
    if (!response.ok) throw new Error('Сервис речи недоступен');
    return response.json();
  }, refetchInterval:3000});
  const speechReady=speechEngine==='openai'?Boolean(speechStatus.data?.openai_ready):speechStatus.data?.state==='ready';
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
    if(speechEngine!=='local'||speechStatus.data?.state!=='not_loaded'||speechLoadRequested.current)return;
    speechLoadRequested.current=true;
    void fetch('/api/speech/load',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(()=>speechStatus.refetch()).catch(()=>setError('Не удалось подготовить локальное распознавание речи'));
  },[speechEngine,speechStatus]);

  async function sendAudio(blob: Blob, generation: number) {
    if (generation !== epoch.current || !blob.size) return;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if(generation!==epoch.current) return;
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await fetch('/api/speech/transcribe', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({audio:btoa(binary),mime_type:blob.type||'audio/webm',engine:speechEngine,language:languageHint.current,context:assembler.current.context()})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Ошибка распознавания');
      if(generation!==epoch.current)return;
      if((result.language==='ru'||result.language==='en')&&Number(result.language_probability)>=0.65)languageHint.current=result.language;
      const utterance=assembler.current.add({text:result.text||'',isQuestion:Boolean(result.is_question),language:result.language||languageHint.current||'auto'});
      if(utterance){
        const line:VoiceLine={id:++transcriptSequence.current,text:utterance.text,source:'Разговор',question:utterance.isQuestion&&utterance.complete,language:utterance.language,complete:utterance.complete};
        setLatestVoice(line);
        if(utterance.complete)setTranscript(items=>[...items,line].slice(-20));
      }
    } catch (e) {if(generation === epoch.current) setError(e instanceof Error ? e.message : 'Ошибка речи');}
  }
  useEffect(()=>{
    speechQueue.onChange=setQueued;
    speechQueue.onError=()=>setError('Ошибка очереди распознавания');
    return ()=>{speechQueue.onChange=undefined;speechQueue.onError=undefined;speechQueue.clear();};
  },[speechQueue]);

  function stopRecorder(){
    if(recorderTimer.current)clearInterval(recorderTimer.current);
    recorderTimer.current=null;
    if(recorder.current){recorder.current.onstop=null;if(recorder.current.state!=='inactive')recorder.current.stop();}
    recorder.current=null;
  }

  function startRecorder() {
    if (!speechEnabled || !speechReady || recorder.current || !destination.current || !streams.current.some(item=>item.stream.getAudioTracks().some(track=>track.readyState==='live'))) return;
    const generation = epoch.current;
    const active = new MediaRecorder(destination.current.stream);
    recorder.current=active;
    active.ondataavailable = event => {
      if(generation!==epoch.current || !event.data.size) return;
      if(!speechQueue.enqueue(()=>sendAudio(event.data,generation))) {
        setDropped(value=>value+1);
        setError('Распознавание не успевает за речью: один фрагмент пропущен.');
      }
    };
    active.onstop = () => {if (generation === epoch.current && recorder.current===active && streams.current.some(item=>item.stream.getAudioTracks().some(t=>t.readyState === 'live'))) active.start();};
    active.start();
    const fragmentMs=speechEngine==='openai'?1200:3000;
    recorderTimer.current=setInterval(() => {if(active.state === 'recording') active.stop();},fragmentMs);
  }
  useEffect(()=>{
    stopRecorder();
    if(speechEnabled&&speechReady)startRecorder();
  // Recorder must be rebuilt when its destination service changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[speechEnabled,speechReady,speechEngine]);

  function stop() {
    epoch.current++;
    speechQueue.clear();
    stopRecorder();
    assembler.current.clear();languageHint.current=undefined;
    streams.current.forEach(item => {item.node?.disconnect();item.stream.getTracks().forEach(track => track.stop());});
    streams.current = [];
    if (meter.current) clearInterval(meter.current);
    if (audio.current) void audio.current.close();
    audio.current = null;
    destination.current=null;analyserSource.current=null;
    if (video.current) video.current.srcObject = null;
    setScreen(false); setMic(false); setSystemAudio(false); setLevel(0);
  }
  useEffect(() => () => {
    epoch.current++;
    speechQueue.clear();
    stopRecorder();
    streams.current.forEach(item => {item.node?.disconnect();item.stream.getTracks().forEach(t => t.stop());});
    if (meter.current) clearInterval(meter.current);
    if (audio.current) void audio.current.close();
  }, [speechQueue]);

  function refreshCaptureState(){
    const display=streams.current.some(item=>item.kind==='display'&&item.stream.getVideoTracks().some(track=>track.readyState==='live'));
    const microphone=streams.current.some(item=>item.kind==='mic'&&item.stream.getAudioTracks().some(track=>track.readyState==='live'));
    const desktopSound=streams.current.some(item=>item.kind==='display'&&item.stream.getAudioTracks().some(track=>track.readyState==='live'));
    setScreen(display);setMic(microphone);setSystemAudio(desktopSound);
    if(!display&&video.current)video.current.srcObject=null;
    if(!streams.current.some(item=>item.stream.getAudioTracks().some(track=>track.readyState==='live')))stopRecorder();
  }

  function removeCapture(item:CaptureStream){
    if(!streams.current.includes(item))return;
    streams.current=streams.current.filter(current=>current!==item);
    item.node?.disconnect();
    item.stream.getTracks().forEach(track=>{if(track.readyState==='live')track.stop();});
    refreshCaptureState();
  }

  function stopKind(kind:CaptureKind){streams.current.filter(item=>item.kind===kind).forEach(removeCapture);}

  async function connectAudio(item:CaptureStream){
    if(!item.stream.getAudioTracks().length)return;
    const context=audio.current||new AudioContext();audio.current=context;
    await context.resume();
    const target=destination.current||context.createMediaStreamDestination();destination.current=target;
    item.node=context.createMediaStreamSource(new MediaStream(item.stream.getAudioTracks()));
    item.node.connect(target);
    if(!analyserSource.current){
      const analyser=context.createAnalyser();analyser.fftSize=1024;
      analyserSource.current=context.createMediaStreamSource(target.stream);analyserSource.current.connect(analyser);
      const samples=new Uint8Array(analyser.fftSize);
      meter.current=setInterval(()=>{
        analyser.getByteTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((sum,n)=>sum+((n-128)/128)**2,0)/samples.length);
        setLevel(Math.min(100,Math.round(rms*300)));
      },100);
    }
    startRecorder();
  }

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
      const item:CaptureStream={stream,source:display?'Системный звук':'Микрофон',kind:display?'display':'mic'};
      streams.current.push(item);
      stream.getTracks().forEach(t => t.addEventListener('ended',()=>removeCapture(item),{once:true}));
      if (display) {
        setScreen(true); setSystemAudio(stream.getAudioTracks().length > 0);
        if (video.current) {video.current.srcObject = stream; await video.current.play();}
      } else setMic(true);
      await connectAudio(item);
      return true;
    } catch (e) {setError(e instanceof Error ? e.message : 'Не удалось включить захват');return false;}
    finally {setBusy(false);}
  }

  async function startSession(){
    setError('');
    setRoleReady('');
    if(!resumeId){setError('Сначала выберите резюме для роли ИИ в настройках.');return {screen:false,mic:false};}
    const roleResponse=await fetch('/api/ai/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resume_id:resumeId})});
    const role=await roleResponse.json();
    if(!roleResponse.ok){setError(typeof role.detail==='string'?role.detail:'Не удалось загрузить роль по резюме');return {screen:false,mic:false};}
    setRoleReady(`Роль загружена: ${role.resume}`);
    if(!wantScreen&&!wantMic){setError('Включите хотя бы один источник: микрофон или звук собеседника.');return {screen:false,mic:false};}
    const hasScreen=!wantScreen?false:screen||await capture(true);
    const hasMic=!wantMic?false:mic||await capture(false);
    return {screen:hasScreen,mic:hasMic};
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

  function savePreference(kind:CaptureKind,value:boolean){
    if(kind==='display'){setWantScreen(value);localStorage.setItem('jobghost-capture-screen',String(value));}
    else{setWantMic(value);localStorage.setItem('jobghost-capture-mic',String(value));}
  }
  async function toggleSource(kind:CaptureKind){
    const active=kind==='display'?screen:mic;
    if(active){stopKind(kind);savePreference(kind,false);return;}
    const sessionActive=screen||mic;
    const preferred=kind==='display'?wantScreen:wantMic;
    savePreference(kind,!preferred||sessionActive);
    if(sessionActive)await capture(kind==='display');
  }
  const engineLabel=speechEngine==='openai'?'OpenAI Speech':'Локально';
  const sessionActive=screen||mic;
  const captureControls=<div className="quick-capture" aria-label="Источники разговора">
    <button className={(sessionActive?systemAudio:wantScreen)?'active':''} aria-pressed={sessionActive?systemAudio:wantScreen} disabled={busy} onClick={()=>void toggleSource('display')}>🔊 Звук собеседника <b>{sessionActive?(systemAudio?'ВКЛ':'выкл'):(wantScreen?'при старте':'не нужен')}</b></button>
    <button className={(sessionActive?mic:wantMic)?'active':''} aria-pressed={sessionActive?mic:wantMic} disabled={busy} onClick={()=>void toggleSource('mic')}>🎙 Мой микрофон <b>{sessionActive?(mic?'ВКЛ':'выкл'):(wantMic?'при старте':'не нужен')}</b></button>
    <span>Речь: {speechEnabled?engineLabel:'выключена'}{queued?` · обработка ${queued}`:''}</span>
  </div>;
  return <ChatAnswer latestQuestion={latestVoice?.text || ''} latestQuestionKey={latestVoice?.id} latestQuestionSource={latestVoice?`${latestVoice.source} · ${latestVoice.language.toUpperCase()}${latestVoice.complete?'':' · слушаю…'}`:undefined} latestQuestionDetected={latestVoice?.question} snapshot={snapshot} getSnapshot={currentSnapshot} onChooseRegion={chooseRegionSnapshot} onStartSession={startSession} sessionActive={sessionActive} onStop={stop} onSnapshot={takeSnapshot} captureControls={captureControls} captureStatus={`Экран: ${screen ? 'ВКЛ' : 'выкл'} · Микрофон: ${mic ? 'ВКЛ' : 'выкл'} · Системный звук: ${systemAudio ? 'ВКЛ' : 'выкл'}${snapshot ? ' · Снимок готов' : ''}${error ? ' · '+error : ''}`} connectionContent={<ChatPairing/>} settingsContent={<>
    <h2>Роль ИИ</h2>
    <label>Резюме для ответов <select aria-label="Резюме для роли ИИ" value={resumeId} disabled={screen||mic} onChange={event=>{setResumeId(event.target.value);localStorage.setItem('jobghost-interview-resume',event.target.value);setRoleReady('');}}><option value="">Выберите резюме</option>{resumes.data?.filter(item=>item.is_active).map(item=><option key={item.id} value={item.id}>{item.name}{item.hh_resume_id?' · HH':''}</option>)}</select></label>
    <p>При каждом запуске сессии выбранный ИИ получает профессиональный контекст резюме. Контакты исключаются, а выдумывать опыт запрещено.</p>
    {roleReady&&<p role="status">{roleReady}</p>}
    <h2>Экран и звук</h2>
    <p>Включайте захват с согласия участников. В локальном режиме аудио не покидает компьютер; в режиме OpenAI Speech короткие фрагменты отправляются в OpenAI. Текст передаётся выбранному ИИ только после включения отправки вопросов.</p>
    <div className="toolbar">
      <button disabled={busy || screen} onClick={() => {savePreference('display',true);void capture(true);}}>Включить звук собеседника</button>
      <button disabled={busy || mic} onClick={() => {savePreference('mic',true);void capture(false);}}>Включить микрофон</button>
      <button disabled={busy} className="secondary" onClick={stop}>Остановить весь захват</button>
    </div>
    <p role="status">Экран: {screen ? 'ЗАХВАТ ВКЛЮЧЁН' : 'выключен'} · Микрофон: {mic ? 'ВКЛЮЧЁН' : 'выключен'} · Системный звук: {systemAudio ? 'ВКЛЮЧЁН' : 'не захватывается'}</p>
    <label>Уровень последнего подключённого аудиоисточника <meter min={0} max={100} value={level}/></label>
    {error && <p role="alert">{error}</p>}
    <video ref={video} muted autoPlay playsInline style={{display: screen ? 'block' : 'none', width: '100%', maxHeight: 360, background: '#000'}}/>
    <button disabled={!screen} onClick={takeSnapshot}>Сделать снимок для вопроса</button>
    {snapshot && <div><img src={snapshot} alt="Выбранный снимок экрана" style={{maxWidth:'100%',maxHeight:300}}/><p><a download="jobghost-screen.jpg" href={snapshot}>Сохранить снимок</a> <button className="secondary" onClick={() => setSnapshot('')}>Удалить снимок</button></p></div>}
    <h3>Распознавание речи</h3>
    <p>{speechEngine==='local'?speechLabel(speechStatus.data?.state):speechStatus.data?.openai_ready?'OpenAI Speech готов':'Для OpenAI Speech сохраните ключ OpenAI в разделе «ИИ»'} · русский и English определяются автоматически. {speechStatus.data?.error || speechStatus.error?.message || ''}</p>
    <button disabled={speechStatus.data?.state === 'loading' || speechStatus.data?.state === 'ready'} onClick={async () => {
      await fetch('/api/speech/load', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}); await speechStatus.refetch();
    }}>Загрузить модель речи на компьютер</button>
    <label><input type="checkbox" checked={speechEnabled} onChange={e=>{setSpeechEnabled(e.target.checked);localStorage.setItem('jobghost-speech-enabled',String(e.target.checked));}}/> Распознавать речь</label>
    <label>Способ распознавания <select aria-label="Способ распознавания речи" value={speechEngine} onChange={event=>{const value=event.target.value as 'local'|'openai';setSpeechEngine(value);localStorage.setItem('jobghost-speech-engine',value);}}><option value="local">Локально · бесплатно, аудио не уходит с компьютера</option><option value="openai" disabled={!speechStatus.data?.openai_ready}>OpenAI Speech · быстрее и точнее, платно</option></select></label>
    <p>Микрофон и звук собеседника смешиваются в один поток без двойной очереди. Короткие фрагменты собираются в целый вопрос до паузы; Ctrl+Enter отправляет текущую реплику вручную.</p>
    <p role="status">Фрагментов в обработке и очереди: {queued}. Пропущено из-за перегрузки: {dropped}.</p>
    {transcript.map(t => <p key={t.id}><small>{t.source} · {t.language.toUpperCase()}{t.question ? ' · вопрос' : ' · речь'}</small><br/>{t.text}</p>)}
    <button className="secondary" onClick={()=>{assembler.current.clear();setLatestVoice(undefined);setTranscript([]);}}>Очистить текст</button>
    </>}/>;
}
