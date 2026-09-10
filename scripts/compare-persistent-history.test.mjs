import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {probe} from './custom-read-preflight.mjs';
import {compareHistory,historyFingerprint} from './compare-persistent-history.mjs';

const data={messages:[{id:1,chat_id:901,is_from_me:false,text:'BODY-SECRET',sender:'ADDRESS-SECRET',sender_name:'NAME-SECRET',reactions:[{id:2,is_from_me:false,sender_name:'REACTION-SECRET'}]}]};
const historyRow={responseMs:10,rows:1,namedRows:1,incoming:2};
const good={outcome:'ok',closed:true,histories:[100,30,10,20].map(ms=>({...historyRow,responseMs:ms})),elapsedMs:200};
async function session(mode='ok',options={}) {
  const body=`const readline=require('readline'); let n=0,busy=false;
    readline.createInterface({input:process.stdin}).on('line',line=>{
      const q=JSON.parse(line),index=n++;
      if(busy)process.exit(10);busy=true;
      const expected=index===0?{jsonrpc:'2.0',id:'preflight',method:'chats.list',params:{limit:50}}:
        {jsonrpc:'2.0',id:'history-'+(index-1),method:'messages.history',params:{chat_id:901,limit:50,attachments:false,convert_attachments:false}};
      if(JSON.stringify(q)!==JSON.stringify(expected)||index>4) process.exit(9);
      if(${JSON.stringify(mode)}==='timeout'&&index===2) return;
      const result=index===0?{chats:[{id:901,is_group:${mode==='group'}}]}:${JSON.stringify(data)};
      if(${JSON.stringify(mode)}==='badreaction'&&index===1) result.messages[0].reactions=[null];
      if(${JSON.stringify(mode)}==='empty'&&index>0) result.messages=[];
      if(index>0&&['fifty','fiftyone'].includes(${JSON.stringify(mode)}))result.messages=Array.from({length:${mode==='fifty'?50:51}},(_,i)=>({...result.messages[0],id:i+1}));
      if(index>0&&${JSON.stringify(mode)}==='badbool')result.messages[0].is_from_me='false';
      if(index>0&&${JSON.stringify(mode)}==='badreactionbool')result.messages[0].reactions[0].is_from_me=0;
      if(index>0&&${JSON.stringify(mode)}==='oversize')result.messages[0].text='x'.repeat(1024*1024);
      if(index>0&&${JSON.stringify(mode)}==='outgoing'){result.messages[0].is_from_me=true;result.messages[0].reactions[0].is_from_me=true;}
      if(${JSON.stringify(mode)}==='wrongid')q.id='wrong';
      const frame=JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n';
      const send=()=>{process.stdout.write(frame);busy=false; if(${JSON.stringify(mode)}==='duplicate') process.stdout.write(frame);
        if(index===4&&${JSON.stringify(mode)}==='late') process.stderr.write('ERROR-SECRET');};
      if(${JSON.stringify(mode)}==='slow') setTimeout(send,100);
      else if(${JSON.stringify(mode)}==='timing')setTimeout(send,index===0?250:30);
      else send();
    }).on('close',()=>{if(${JSON.stringify(mode)}==='ok'&&n!==5) process.exitCode=8;});`;
  const r=await probe(()=>spawn(process.execPath,['-e',body],{stdio:'pipe'}),{history:true,timeoutMs:1000,graceMs:100,...options});
  assert.equal(r.closed,true); assert.ok(!JSON.stringify(r).includes('SECRET'));
  return r;
}
test('H1 fixed five requests on one child, target selection and warm metadata',async()=>{
  let target,observed=0;
  const r=await session('ok',{observeTarget:id=>{target=id;},observeHistory:()=>observed++});
  assert.equal(target,901);assert.equal(observed,4);assert.equal(r.outcome,'ok');assert.equal(r.histories.length,4);
  assert.ok(r.histories.every(h=>h.incoming===2));
});
test('H3 invalid target/reactions/frames and terminal stderr',async()=>{
  for(const [mode,outcome] of [['group','no-target'],['badreaction','protocol'],['wrongid','protocol'],['duplicate','protocol'],['late','stderr']]) {
    assert.equal((await session(mode)).outcome,outcome);
  }
  assert.equal((await session('ok',{target:999})).outcome,'no-target');
  assert.equal((await session('empty')).outcome,'ok');
});
test('H4 per-request and overall deadlines',async()=>{
  assert.equal((await session('timeout')).outcome,'timeout');
  assert.equal((await session('slow',{overallMs:350})).outcome,'overall-timeout');
});
test('H1/H2 delayed responses never overlap and history clock resets',async()=>{
  const r=await session('timing');assert.equal(r.outcome,'ok');
  assert.ok(r.histories.every(h=>h.responseMs>=20&&h.responseMs<200));
  assert.ok(r.elapsedMs>=350);
});
test('H3 history-specific row/boolean/frame boundaries and outgoing counter',async()=>{
  for(const [mode,outcome] of [['fifty','ok'],['fiftyone','protocol'],['badbool','protocol'],['badreactionbool','protocol'],['oversize','oversize'],['outgoing','ok']]){
    const r=await session(mode);assert.equal(r.outcome,outcome);
    if(mode==='fifty')assert.ok(r.histories.every(h=>h.rows===50));
    if(mode==='outgoing')assert.ok(r.histories.every(h=>h.incoming===0));
  }
});
test('H5 names at message/reaction paths and key-order equivalence',()=>{
  const key=Buffer.alloc(32,1),a=historyFingerprint(data,key);
  const renamed=structuredClone(data);renamed.messages[0].reactions[0].sender_name='OTHER';
  const b=historyFingerprint(renamed,key);assert.equal(a.payload,b.payload);assert.notEqual(a.names,b.names);
  const reordered={messages:[{...data.messages[0],reactions:[{sender_name:'REACTION-SECRET',is_from_me:false,id:2}]}]};
  assert.deepEqual(a,historyFingerprint(reordered,key));
  const changed=structuredClone(data);changed.messages[0].sender='OTHER';assert.notEqual(a.payload,historyFingerprint(changed,key).payload);
});
test('H2/H6 session median excludes warmup; ABBA target consistency and no pooling',async()=>{
  const calls=[];let active=0,max=0;
  const r=await compareHistory(async(arm,o)=>{
    active++;max=Math.max(max,active);calls.push(arm);await new Promise(resolve=>setImmediate(resolve));
    if(calls.length>1) assert.equal(o.target,901);o.observeTarget(901);
    for(let i=0;i<4;i++)o.observeHistory(data,i);active--;return good;
  });
  assert.deepEqual(calls,['A','B','B','A']);assert.equal(max,1);
  assert.ok(r.sessions.every(s=>s.warmupMs===100&&s.steady.median===20&&s.steady.min===10&&s.steady.max===30));
  assert.ok(r.pairs.every(p=>p.eligible));assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('H6 prior matched pair retained if a later session fails; stop immediately',async()=>{
  let count=0;
  const r=await compareHistory(async(_,o)=>{
    if(++count===3)return{outcome:'timeout',closed:true};
    o.observeTarget(901);for(let i=0;i<4;i++)o.observeHistory(data,i);return good;
  });
  assert.equal(count,3);assert.equal(r.complete,false);assert.equal(r.pairs[0].eligible,true);
});
test('H6 any empty or zero-lookup history and names-only mismatch exclude pair',async()=>{
  for(const mode of ['empty','no-lookup','names']) {
    const r=await compareHistory(async(arm,o)=>{
      o.observeTarget(901);for(let i=0;i<4;i++){
        const value=structuredClone(data);if(mode==='names'&&arm==='B')value.messages[0].sender_name='OTHER';o.observeHistory(value,i);
      }
      const result=structuredClone(good);
      if(mode==='empty')result.histories[2].rows=0;
      if(mode==='no-lookup')result.histories[2].incoming=0;
      return result;
    });
    assert.ok(r.pairs.every(p=>!p.eligible));assert.equal(r.comparison,'no-attributable-comparison');
  }
});
test('H5 parent harness output contains neither content nor private identifiers/fingerprints',async()=>{
  for(const mode of ['ok','late']){
    const script=`import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
      import {probe} from ${JSON.stringify(new URL('./custom-read-preflight.mjs',import.meta.url).href)};
      import {compareHistory} from ${JSON.stringify(new URL('./compare-persistent-history.mjs',import.meta.url).href)};
      const data=${JSON.stringify(data)};const session=${session.toString()};
      console.log(JSON.stringify(await compareHistory((_,o)=>session(${JSON.stringify(mode)},o))));`;
    const parent=spawn(process.execPath,['--input-type=module','-e',script],{stdio:'pipe'});
    let stdout='',stderr='';parent.stdout.on('data',b=>stdout+=b);parent.stderr.on('data',b=>stderr+=b);
    const code=await new Promise(resolve=>parent.once('close',resolve));
    assert.equal(code,0);assert.equal(stderr,'');assert.ok(!stdout.includes('SECRET')&&!/[a-f0-9]{64}/.test(stdout));
    assert.ok(!stdout.includes('chat_id')&&!stdout.includes('target')&&!stdout.includes('901'));
    const r=JSON.parse(stdout);assert.equal(r.complete,mode==='ok');
  }
});
