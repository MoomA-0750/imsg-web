import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiWorkload } from './nonlaunch-api-workload.mjs';

function fixture(change = () => {}) {
  const caps = { epoch: 'epoch-SECRET', mode: 'readonly', features: Object.fromEntries(['chats', 'history', 'read', 'typing'].map(k => [k, ['chats','history'].includes(k) ? {state:'available'} : {state:'unknown',reasonCode:'STATUS_PROBE_DISABLED'}])) };
  const chat = id => ({id,name:'NAME-SECRET',service:'iMessage',isGroup:false,unreadCount:0,lastMessageAt:null,trimmed:false});
  const chats = {epoch:caps.epoch,limit:50,chats:[chat('target-SECRET'),chat('second-SECRET')]};
  const history = {epoch:caps.epoch,limit:50,messages:[{id:'message-SECRET',text:'BODY-SECRET',isFromMe:false,createdAt:null,trimmed:false}]};
  change({caps,chats,history});
  const paths=[];
  const get = async path => { paths.push(path); return {status:200,data:structuredClone(path === '/api/capabilities' ? caps : path === '/api/chats?limit=50' ? chats : history)}; };
  return {caps,chats,history,paths,get};
}
test('fixed sequential GET workload, retained target and exact monotonic timing', async () => {
  const f=fixture();let time=0,active=0;
  const run=createApiWorkload(async path=>{assert.equal(active++,0);await Promise.resolve();time+=10;active--;return f.get(path);},()=>time);
  const first=await run();
  assert.deepEqual(first,{outcome:'ok',gateMeasurement:false,capabilitiesMs:10,chatsMs:10,historyMs:10,cycleMs:30,chats:2,messages:1,nonemptyHistory:true});
  f.chats.chats.reverse();assert.equal((await run()).outcome,'ok');
  assert.deepEqual(f.paths,Array(2).fill(['/api/capabilities','/api/chats?limit=50','/api/chats/target-SECRET/messages?limit=50']).flat());
  assert.ok(!JSON.stringify(first).includes('SECRET'));
});
test('epoch changes, lost target and HTTP failures stop session without retry', async () => {
  for(const fault of ['epoch','target','http']) {
    const f=fixture();let fail=false;
    const run=createApiWorkload(path=>fail&&fault==='http'?{status:401,data:{secret:'SECRET'}}:f.get(path));
    assert.equal((await run()).outcome,'ok');fail=true;
    if(fault==='epoch')f.caps.epoch='changed';
    if(fault==='target')f.chats.chats.shift();
    assert.equal((await run()).outcome,'failed');const count=f.paths.length;
    assert.equal((await run()).outcome,'unavailable');assert.equal(f.paths.length,count);
  }
});
test('bad DTOs and advanced discovery fail closed with fixed categories', async () => {
  const mutations=[
    f=>f.caps.features.read.state='available', f=>delete f.caps.features.typing.reasonCode,
    f=>f.caps.features.chats.state='unknown', f=>f.caps.epoch='../secret',
    f=>f.chats.epoch='changed', f=>f.chats.limit=100, f=>f.chats.chats=[],
    f=>f.chats.chats.push(f.chats.chats[0]), f=>f.chats.chats[0].id='a/b',
    f=>f.chats.chats[0].name=null, f=>f.history.epoch='changed',
    f=>f.history.messages[0].isFromMe='false', f=>f.history.messages[0].text=null,
    f=>f.history.messages=Array(51).fill(f.history.messages[0]),
    f=>f.history.messages.push(f.history.messages[0]),
  ];
  for(const change of mutations){const f=fixture(change);const r=await createApiWorkload(f.get)();assert.equal(r.outcome,'failed');assert.ok(!JSON.stringify(r).includes('SECRET'));}
});
test('empty history is measured but explicitly not evidence of nonempty workload', async()=>{
  const f=fixture(f=>f.history.messages=[]);const r=await createApiWorkload(f.get)();
  assert.equal(r.outcome,'ok');assert.equal(r.nonemptyHistory,false);assert.equal(r.gateMeasurement,false);
});
test('overlap issues no request; transport rejection is redacted and terminal', async()=>{
  let release,calls=0;
  const run=createApiWorkload(()=>{calls++;return new Promise((_,reject)=>release=()=>reject(new Error('BODY-SECRET')));});
  const pending=run();assert.equal((await run()).outcome,'unavailable');assert.equal(calls,1);
  release();assert.deepEqual(await pending,{outcome:'failed',phase:'capabilities',gateMeasurement:false});
  assert.equal((await run()).outcome,'unavailable');assert.equal(calls,1);
});
test('a fresh arm uses its own opaque ID and invalid clocks fail', async()=>{
  for(const id of ['arm-A','arm-B']){const f=fixture(f=>f.chats.chats[0].id=id);assert.equal((await createApiWorkload(f.get)()).outcome,'ok');assert.ok(f.paths[2].includes(id));}
  for(const now of [()=>NaN,(()=>{let n=0;return()=>--n;})()])assert.equal((await createApiWorkload(fixture().get,now)()).outcome,'failed');
});
