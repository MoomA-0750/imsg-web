import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fingerprint, compare } from './compare-custom-release.mjs';
import { probe } from './custom-read-preflight.mjs';

const payload = { chats: [{ id: 1, contact_name: 'SECRET', identifier: 'PRIVATE', is_group: false }] };
const ok = { outcome: 'ok', closed: true, rows: 1, namedRows: 1, responseMs: 10, elapsedMs: 20 };
test('R3 canonical equality preserves arrays and optional names', () => {
  const key = Buffer.alloc(32, 7), first = fingerprint(payload,key);
  assert.deepEqual(first, fingerprint({chats:[{is_group:false, identifier:'PRIVATE', contact_name:'SECRET', id:1}]},key));
  for (const row of [{id:2}, {id:1,identifier:'OTHER'}, {id:1,contact_name:''}, {id:1,contact_name:null}]) {
    assert.notDeepEqual(first, fingerprint({chats:[row]},key));
  }
  const two = {chats:[{id:1},{id:2}]};
  assert.notEqual(fingerprint(two,key).payload, fingerprint({chats:[...two.chats].reverse()},key).payload);
  assert.notEqual(fingerprint({chats:[{id:1}]},key).names, fingerprint({chats:[{id:1,contact_name:null}]},key).names);
  const renamed = fingerprint({chats:[{...payload.chats[0],contact_name:'OTHER'}]},key);
  assert.equal(first.payload,renamed.payload); assert.notEqual(first.names,renamed.names);
});
test('R3 names-only mismatch excludes every otherwise equal pair', async () => {
  const r = await compare(async (arm,limit,observe) => {
    observe({chats:[{...payload.chats[0],contact_name:arm==='A'?'SECRET':'OTHER'}]}); return ok;
  });
  assert.equal(r.comparison,'no-attributable-comparison'); assert.equal(r.eligible.A.responseMs,null);
  assert.ok(r.pairs.every(p=>p.payloadEqual && !p.namesEqual && !p.eligible));
});
test('R4 fixed order, invalid pair excluded and fingerprints kept private', async () => {
  const calls = [];
  const report = await compare(async (arm, limit, observe) => {
    calls.push([arm,limit]);
    observe(calls.length === 4 ? {chats:[{id:9,contact_name:'SECRET'}]} : payload);
    return { ...ok, responseMs: calls.length === 4 ? 999 : 10, elapsedMs: calls.length === 4 ? 999 : 20 };
  });
  assert.deepEqual(calls, [['A',1],['B',1],...['A','B','B','A','A','B','B','A'].map(a=>[a,50])]);
  assert.equal(report.complete,true); assert.deepEqual(report.pairs.map(p=>p.eligible),[false,true,true,true]);
  assert.equal(report.eligible.B.responseMs.max,10); assert.equal(report.eligible.A.responseMs.count,3);
  assert.equal(report.eligible.B.elapsedMs.max,20);
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('SECRET') && !serialized.includes('PRIVATE'));
  assert.ok(!/[a-f0-9]{64}/.test(serialized));
});
test('R4 asynchronous execution stays serial and empty data is not eligible', async () => {
  let active=0, max=0;
  const r=await compare(async (_,__,observe)=>{
    active++; max=Math.max(max,active); await new Promise(resolve=>setImmediate(resolve));
    observe({chats:[]}); active--; return {...ok,rows:0,namedRows:0};
  });
  assert.equal(max,1); assert.equal(r.comparison,'no-attributable-comparison');
  assert.ok(r.pairs.every(p=>!p.eligible));
});
test('R4 every failure stops further requests including preflight', async () => {
  for(let failAt=1; failAt<=10; failAt++) {
    let count=0;
    const r = await compare(async (_,__,observe) => {
      count++; if(count===failAt) return {outcome:'timeout',closed:true};
      observe(payload); return ok;
    });
    assert.equal(count,failAt); assert.equal(r.complete,false);
    if(failAt<=4) assert.equal(r.comparison,'no-attributable-comparison');
  }
});
test('R1 fixed 50 limit and R2 delayed close timing', async () => {
  const body = `let text=''; process.stdin.on('data',b=>{ text+=b; if(!text.includes('\\n')) return;
    if(JSON.parse(text).params.limit!==50) process.exit(9);
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'preflight',result:${JSON.stringify(payload)}})+'\\n');
  }); process.stdin.on('end',()=>setTimeout(()=>{},100));`;
  const r = await probe(()=>spawn(process.execPath,['-e',body],{stdio:'pipe'}),{limit:50});
  assert.equal(r.outcome,'ok'); assert.ok(r.elapsedMs-r.responseMs>=80);
  assert.throws(()=>probe(()=>{ throw new Error('must not spawn'); },{limit:2}));
});
test('R1 50 rows accepted, 51 rows rejected by the 50-row mode', async () => {
  for(const [limit,count] of [[50,50],[50,51],[1,2]]) {
    const data={chats:Array.from({length:count},(_,i)=>({id:i+1}))};
    const script=`process.stdin.resume(); process.stdin.once('data',()=>process.stdout.write(${JSON.stringify(JSON.stringify({jsonrpc:'2.0',id:'preflight',result:data})+'\n')}));`;
    const r=await probe(()=>spawn(process.execPath,['-e',script],{stdio:'pipe'}),{limit});
    assert.equal(r.outcome,count===50?'ok':'protocol'); assert.equal(r.closed,true);
  }
});
