import {expect,test} from 'vitest';
import {SerialWorkQueue} from './SerialWorkQueue';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('simultaneous microphone and system jobs run serially without loss',async()=>{
  const queue=new SerialWorkQueue(4),order:string[]=[];
  let release:()=>void=()=>{};
  queue.enqueue(async()=>{order.push('mic start');await new Promise<void>(r=>{release=r;});order.push('mic end');});
  queue.enqueue(async()=>{order.push('system');});
  expect(queue.size).toBe(2);expect(order).toEqual(['mic start']);
  release();await tick();
  expect(order).toEqual(['mic start','mic end','system']);expect(queue.size).toBe(0);
});
test('clear discards waiting audio but never overlaps an active recognizer',async()=>{
  const queue=new SerialWorkQueue(2),order:string[]=[];
  let release:()=>void=()=>{};
  queue.enqueue(async()=>{await new Promise<void>(r=>{release=r;});order.push('old active');});
  queue.enqueue(async()=>{order.push('discarded');});queue.clear();
  queue.enqueue(async()=>{order.push('new session');});
  expect(order).toEqual([]);release();await tick();
  expect(order).toEqual(['old active','new session']);
});
test('bounded queue reports overflow and continues after an error',async()=>{
  const queue=new SerialWorkQueue(1),order:string[]=[],errors:unknown[]=[];
  queue.onError=error=>errors.push(error);
  let release:()=>void=()=>{};
  queue.enqueue(async()=>{await new Promise<void>(r=>{release=r;});throw Error('fixture');});
  expect(queue.enqueue(async()=>{order.push('accepted');})).toBe(true);
  expect(queue.enqueue(async()=>{order.push('overflow');})).toBe(false);
  release();await tick();expect(errors).toHaveLength(1);expect(order).toEqual(['accepted']);
});
