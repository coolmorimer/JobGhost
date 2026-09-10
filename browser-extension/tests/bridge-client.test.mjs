import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeClient} from '../bridge-client.js';
const credentials={tabId:42,code:'a'.repeat(43),consent:true};
export function fixture(inspect=async()=>({ready:true,reason:'connected'}),wait=async()=>{},onDisconnected=()=>{}){
  const sockets=[],intervals=new Set(),timeouts=new Set(),submits=[];
  class Socket{
    readyState=1;sent=[];
    constructor(){sockets.push(this);}
    send(data){this.sent.push(JSON.parse(data));}
    close(){this.readyState=3;this.onclose?.({code:1000});}
    async emit(data){await this.onmessage({data:JSON.stringify(data)});}
  }
  const timers={setInterval:fn=>{intervals.add(fn);return fn;},clearInterval:fn=>intervals.delete(fn),setTimeout:fn=>{timeouts.add(fn);return fn;},clearTimeout:fn=>timeouts.delete(fn)};
  const submit=async tab=>{submits.push(tab);};
  const client=createBridgeClient({inspect,submit,onDisconnected,wait,Socket,timers});
  const connect=async()=>{await client.connect(credentials);const ws=sockets.at(-1);ws.onopen();await ws.emit({type:'connected'});return ws;};
  return {client,sockets,intervals,timeouts,submits,connect};
}
test('background client authenticates once and checks heartbeat without settings DOM',async()=>{
  const f=fixture();const ws=await f.connect();
  assert.equal(f.client.state().connected,true);assert.equal(f.client.state().tabId,42);
  assert.equal(ws.sent[0].code,credentials.code);assert.equal(f.timeouts.size,0);
  ws.sent=[];await ws.emit({type:'ping'});
  assert.deepEqual(ws.sent,[{type:'heartbeat',ready:true,reason:'connected'}]);
  for(const beat of f.intervals)beat();await Promise.resolve();
  assert.ok(ws.sent.some(m=>m.type==='keepalive'));
  f.client.disconnect();assert.equal(f.intervals.size,0);
});
test('expired code and network failures remain readable',async()=>{
  const f=fixture();await f.client.connect(credentials);f.sockets[0].onclose({code:1008});
  assert.match(f.client.state().message,/Код неверный/);assert.equal(f.client.state().connected,false);
  await f.client.connect(credentials);f.sockets[1].onerror();assert.match(f.client.state().message,/Нет связи с сервером/);
});
test('unexpected socket close schedules automatic reconnection',async()=>{
  let reconnects=0;const f=fixture(undefined,undefined,()=>{reconnects++;});const ws=await f.connect();
  ws.onclose({code:1006});assert.equal(f.client.state().connected,false);assert.equal(reconnects,0);
  for(const retry of [...f.timeouts])retry();assert.equal(reconnects,1);
});
test('closed target page reports not-ready without retries',async()=>{
  let ready=true;const f=fixture(async()=>{if(!ready)throw Error('closed');return {ready:true};});const ws=await f.connect();
  ready=false;ws.sent=[];await ws.emit({type:'ping'});
  assert.deepEqual(ws.sent,[{type:'heartbeat',ready:false,reason:'tab_unavailable'}]);f.client.disconnect();
});
test('duplicate transport question is never submitted twice',async()=>{
  const calls=[];const f=fixture(async(tab,operation,payload)=>{if(operation==='prepare'||operation==='collect')calls.push({tab,operation,payload});if(operation==='prepare')return {...payload,prepared:true,user_count:0,answer_count:0,path:'/c/test'};if(operation==='collect')return {answer:'fixture'};return {ready:true};});const ws=await f.connect();
  const question={type:'question',id:'one',question:'hello',image:'fixture'};
  await ws.emit(question);await ws.emit(question);
  assert.equal(calls.length,2);assert.equal(calls[0].tab,42);assert.equal(calls[0].payload.image,'fixture');
  assert.equal(calls[0].operation,'prepare');assert.equal(calls[1].operation,'collect');assert.deepEqual(f.submits,[42]);
  assert.equal(ws.sent.filter(m=>m.type==='result').length,1);f.client.disconnect();
});
test('answer polling runs in the worker and publishes only the completed snapshot',async()=>{
  let polls=0;const f=fixture(async(_tab,operation,payload)=>{if(operation==='prepare')return {...payload,user_count:0,answer_count:0,path:'/c/test'};if(operation==='collect')return ++polls<3?{pending:true}:{answer:'done'};return {ready:true};});
  const ws=await f.connect();await ws.emit({type:'question',id:'poll',question:'hello'});
  assert.equal(polls,3);assert.deepEqual(f.submits,[42]);assert.equal(ws.sent.find(message=>message.id==='poll').answer,'done');f.client.disconnect();
});
test('diagnostic returns safe page counters without submitting a question',async()=>{
  const f=fixture(async(_tab,operation)=>operation==='diagnostic'?{users:2,answers:2,expected_length:1200,observed_length:1210,exact:false,prefix_match:true}:{ready:true});
  const ws=await f.connect();await ws.emit({type:'diagnostic',id:'diag',question:'expected'});
  const result=ws.sent.find(message=>message.id==='diag');
  assert.equal(result.diagnostic.prefix_match,true);assert.deepEqual(f.submits,[]);f.client.disconnect();
});
test('disconnect during page check cancels connection creation',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.client.connect(credentials);f.client.disconnect();finish({ready:true});await pending;
  assert.equal(f.sockets.length,0);assert.equal(f.client.state().connected,false);
});
test('late answer after disconnect is not published and reconnect waits for it',async()=>{
  let finish;const f=fixture(async(_tab,operation)=>operation==='prepare'?{question:'hello',user_count:0,answer_count:0,path:'/c/test'}:operation==='collect'?await new Promise(resolve=>{finish=resolve;}):{ready:true});const ws=await f.connect();
  const pending=ws.emit({type:'question',id:'one',question:'hello'});f.client.disconnect();
  await assert.rejects(f.client.connect(credentials),/уже активен/);
  finish({answer:'late fixture'});await pending;
  assert.equal(ws.sent.filter(m=>m.type==='result').length,0);assert.equal(f.client.state().running,false);
});
test('consent and code validation happen before page access',async()=>{
  let inspections=0;const f=fixture(async()=>{inspections++;return {ready:true};});
  await assert.rejects(f.client.connect({...credentials,consent:false}),/разрешение/);
  await assert.rejects(f.client.connect({...credentials,code:'expired'}),/код/);assert.equal(inspections,0);
});
test('server handshake timeout closes the socket and does not reconnect',async()=>{
  const f=fixture();await f.client.connect(credentials);for(const timeout of [...f.timeouts])timeout();
  assert.equal(f.sockets.length,1);assert.equal(f.sockets[0].readyState,3);assert.match(f.client.state().message,/не подтвердил/);
});
