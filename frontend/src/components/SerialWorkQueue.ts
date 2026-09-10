/** One active job plus a bounded waiting queue. Clearing never starts a second worker. */
export class SerialWorkQueue {
  private waiting:(()=>Promise<void>)[]=[];
  private running=false;
  onChange?: (size:number)=>void;
  onError?: (error:unknown)=>void;
  constructor(private readonly capacity=4) {}
  get size() {return this.waiting.length + Number(this.running);}
  enqueue(work:()=>Promise<void>) {
    if(this.waiting.length>=this.capacity) return false;
    this.waiting.push(work);
    if(!this.running) void this.drain();
    else this.onChange?.(this.size);
    return true;
  }
  clear() {this.waiting=[];this.onChange?.(this.size);}
  private async drain() {
    this.running=true;
    while(this.waiting.length) {
      const work=this.waiting.shift()!;
      this.onChange?.(this.size);
      try {await work();} catch(error) {this.onError?.(error);}
    }
    this.running=false;
    this.onChange?.(0);
  }
}
