export type SpeechFragment={
  text:string;
  isQuestion:boolean;
  language:string;
};

export type VoiceUtterance={
  text:string;
  isQuestion:boolean;
  language:string;
  complete:boolean;
};

type Pending={text:string;isQuestion:boolean;language:string;fragments:number};

function joinWithoutEcho(previous:string,next:string){
  if(!previous)return next;
  const left=previous.trim();
  const right=next.trim();
  if(!right)return left;
  if(left.toLocaleLowerCase().endsWith(right.toLocaleLowerCase()))return left;
  if(right.toLocaleLowerCase().startsWith(left.toLocaleLowerCase()))return right;
  const leftWords=left.split(/\s+/);
  const rightWords=right.split(/\s+/);
  const maximum=Math.min(8,leftWords.length,rightWords.length);
  for(let size=maximum;size>0;size--){
    const tail=leftWords.slice(-size).join(' ').toLocaleLowerCase();
    const head=rightWords.slice(0,size).join(' ').toLocaleLowerCase();
    if(tail===head)return `${left} ${rightWords.slice(size).join(' ')}`.trim();
  }
  return `${left} ${right}`;
}

/** Собирает цельную реплику из коротких результатов распознавания. */
export class VoiceUtteranceAssembler{
  private pending:Pending={text:'',isQuestion:false,language:'auto',fragments:0};

  add(fragment:SpeechFragment):VoiceUtterance|null{
    const text=fragment.text.trim();
    if(!text){
      if(!this.pending.text)return null;
      return this.finish();
    }
    this.pending={
      text:joinWithoutEcho(this.pending.text,text),
      isQuestion:this.pending.isQuestion||fragment.isQuestion||text.includes('?'),
      language:fragment.language&&fragment.language!=='auto'?fragment.language:this.pending.language,
      fragments:this.pending.fragments+1,
    };
    // An intermediate question mark is not a reliable turn boundary; silence wins.
    if(this.pending.fragments>=12||this.pending.text.length>=1400){
      return this.finish();
    }
    return {...this.pending,complete:false};
  }

  flush():VoiceUtterance|null{return this.pending.text?this.finish():null;}

  context(limit=500){return this.pending.text.slice(-limit);}

  clear(){this.pending={text:'',isQuestion:false,language:'auto',fragments:0};}

  private finish():VoiceUtterance{
    const result={text:this.pending.text,isQuestion:this.pending.isQuestion,language:this.pending.language,complete:true};
    this.clear();
    return result;
  }
}
