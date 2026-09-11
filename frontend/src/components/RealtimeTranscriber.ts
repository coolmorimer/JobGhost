export type LiveTranscriptCallbacks={
  onPartial:(text:string)=>void;
  onFinal:(text:string)=>void;
  onError:(message:string)=>void;
};
export const LIVE_SILENCE_MS=1100;

export function pcmRms(samples:Int16Array){
  if(!samples.length)return 0;
  let energy=0;
  for(const sample of samples)energy+=(sample/32768)**2;
  return Math.sqrt(energy/samples.length);
}

export function resamplePcm16(input:Float32Array,inputRate:number,outputRate=24000){
  if(!input.length)return new Int16Array();
  const ratio=inputRate/outputRate;
  const length=Math.max(1,Math.floor(input.length/ratio));
  const result=new Int16Array(length);
  for(let index=0;index<length;index++){
    const start=Math.floor(index*ratio);
    const end=Math.max(start+1,Math.min(input.length,Math.floor((index+1)*ratio)));
    let sum=0;
    for(let source=start;source<end;source++)sum+=input[source];
    const sample=Math.max(-1,Math.min(1,sum/(end-start)));
    result[index]=sample<0?Math.round(sample*0x8000):Math.round(sample*0x7fff);
  }
  return result;
}

function pcmBase64(samples:Int16Array){
  const bytes=new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength);
  let binary='';
  for(let index=0;index<bytes.length;index+=0x8000){
    binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
  }
  return btoa(binary);
}

/** Streams one audio source to the local backend; the OpenAI key never enters the renderer. */
export class RealtimeTranscriber{
  private socket:WebSocket|null=null;
  private context:AudioContext|null=null;
  private source:MediaStreamAudioSourceNode|null=null;
  private processor:ScriptProcessorNode|null=null;
  private ready=false;
  private closing=false;
  private partials=new Map<string,string>();
  private speaking=false;
  private silenceMs=0;
  private prefix:string[]=[];

  constructor(private readonly stream:MediaStream,private readonly callbacks:LiveTranscriptCallbacks){}

  async start(){
    if(this.socket)return;
    const scheme=location.protocol==='https:'?'wss':'ws';
    const socket=new WebSocket(`${scheme}://${location.host}/api/speech/live`);
    this.socket=socket;
    socket.onmessage=event=>this.handleMessage(String(event.data));
    socket.onerror=()=>{if(!this.closing)this.callbacks.onError('Не удалось подключить OpenAI Live');};
    socket.onclose=event=>{
      this.ready=false;
      if(!this.closing&&event.code!==1000)this.callbacks.onError(event.reason||'OpenAI Live отключился');
    };
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('OpenAI Live не ответил за 8 секунд')),8000);
      socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Не удалось подключить OpenAI Live'));},{once:true});
    });
    if(this.closing)return;
    const context=new AudioContext();
    await context.resume();
    const source=context.createMediaStreamSource(new MediaStream(this.stream.getAudioTracks()));
    const processor=context.createScriptProcessor(4096,1,1);
    const silent=context.createGain();silent.gain.value=0;
    processor.onaudioprocess=event=>{
      if(!this.ready||socket.readyState!==WebSocket.OPEN)return;
      const samples=resamplePcm16(event.inputBuffer.getChannelData(0),context.sampleRate);
      if(!samples.length)return;
      const encoded=pcmBase64(samples),durationMs=samples.length/24;
      if(!this.speaking){
        this.prefix.push(encoded);this.prefix=this.prefix.slice(-4);
        if(pcmRms(samples)<0.012)return;
        this.speaking=true;this.silenceMs=0;
        for(const audio of this.prefix)socket.send(JSON.stringify({type:'input_audio_buffer.append',audio}));
        this.prefix=[];return;
      }
      socket.send(JSON.stringify({type:'input_audio_buffer.append',audio:encoded}));
      if(pcmRms(samples)>=0.012){this.silenceMs=0;return;}
      this.silenceMs+=durationMs;
      if(this.silenceMs>=LIVE_SILENCE_MS){
        socket.send(JSON.stringify({type:'input_audio_buffer.commit'}));
        this.speaking=false;this.silenceMs=0;this.prefix=[];
      }
    };
    source.connect(processor);processor.connect(silent);silent.connect(context.destination);
    this.context=context;this.source=source;this.processor=processor;
  }

  stop(){
    this.closing=true;this.ready=false;
    if(this.speaking&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({type:'input_audio_buffer.commit'}));
    this.processor?.disconnect();this.source?.disconnect();
    if(this.processor)this.processor.onaudioprocess=null;
    if(this.context)void this.context.close();
    if(this.socket&&this.socket.readyState<2)this.socket.close(1000,'capture stopped');
    this.processor=null;this.source=null;this.context=null;this.socket=null;this.partials.clear();this.prefix=[];this.speaking=false;this.silenceMs=0;
  }

  private handleMessage(raw:string){
    let event:Record<string,unknown>;
    try{event=JSON.parse(raw);}catch{return;}
    const type=String(event.type||'');
    if(type==='session.updated'){this.ready=true;return;}
    if(type==='error'){
      const error=event.error as {message?:string}|undefined;
      this.callbacks.onError(error?.message||String(event.message||'Ошибка OpenAI Live'));
      return;
    }
    const item=String(event.item_id||'current');
    if(type==='conversation.item.input_audio_transcription.delta'){
      const text=(this.partials.get(item)||'')+String(event.delta||'');
      this.partials.set(item,text);this.callbacks.onPartial(text.trim());
    }
    if(type==='conversation.item.input_audio_transcription.completed'){
      const text=String(event.transcript||this.partials.get(item)||'').trim();
      this.partials.delete(item);if(text)this.callbacks.onFinal(text);
    }
  }
}
