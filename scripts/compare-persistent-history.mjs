import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonical } from './compare-custom-release.mjs';
import { probe, verifyArtifact } from './custom-read-preflight.mjs';

export function historyFingerprint(payload,key) {
  const names = [];
  const strip = (row,path) => {
    const copy = {...row};
    for(const field of ['sender_name','contact_name']) {
      if(Object.hasOwn(copy,field)) { names.push([path,field,copy[field]]); delete copy[field]; }
    }
    return copy;
  };
  const messages = payload.messages.map((message,index)=>{
    const row=strip(message,`message${index}`);
    row.reactions=message.reactions.map((r,j)=>strip(r,`message${index}.reaction${j}`));
    return row;
  });
  const hash = value=>createHmac('sha256',key).update(canonical(value)).digest('hex');
  return {payload:hash({...payload,messages}),names:hash(names)};
}
function sessionStats(histories) {
  const values=histories.slice(1).map(h=>h.responseMs).sort((a,b)=>a-b);
  return {warmupMs:histories[0].responseMs,steady:{median:values[1],min:values[0],max:values[2]}};
}
export async function compareHistory(execute) {
  const key=randomBytes(32),sessions=[],marks=[];
  let target,complete=true;
  try {
    for(const arm of ['A','B','B','A']) {
      const hashes=[];
      const r=await execute(arm,{history:true,target,observeTarget:id=>{target=id;},observeHistory:(data,index)=>{hashes[index]=historyFingerprint(data,key);}});
      const valid=r.outcome==='ok' && r.histories?.length===4 && hashes.length===4;
      sessions.push({arm,...r,...(valid?sessionStats(r.histories):{})}); marks.push(hashes);
      if(!valid) {complete=false;break;}
    }
    const pairs=[];
    for(let i=0;i+1<sessions.length;i+=2) {
      const a=sessions[i],b=sessions[i+1];
      const valid=a.outcome==='ok'&&b.outcome==='ok'&&marks[i].length===4&&marks[i+1].length===4;
      const payloadEqual=Boolean(valid&&marks[i].every((m,j)=>m.payload===marks[i+1][j].payload));
      const namesEqual=Boolean(valid&&marks[i].every((m,j)=>m.names===marks[i+1][j].names));
      const workload=Boolean(valid&&[a,b].every(s=>s.histories.every(h=>h.rows>0&&h.incoming>0)));
      pairs.push({sessions:[i+1,i+2],payloadEqual,namesEqual,lookupWorkload:workload,eligible:payloadEqual&&namesEqual&&workload});
    }
    return {complete,scope:'persistent-history50',sessions,pairs,comparison:pairs.some(p=>p.eligible)?'matched-session-pairs':'no-attributable-comparison'};
  } finally {key.fill(0);marks.length=0;target=undefined;}
}
async function main() {
  let report;
  try {
    const [root,pathA,digestA,pathB,digestB,...extra]=process.argv.slice(2);
    if(extra.length||![digestA,digestB].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s))||process.platform!=='darwin'||(!process.env.SSH_CONNECTION&&!process.env.SSH_CLIENT)) throw new Error();
    const artifacts={A:{path:pathA,digest:digestA},B:{path:pathB,digest:digestB}},verified={};
    report=await compareHistory(async(arm,options)=>{
      try {
        const a=artifacts[arm],binary=await verifyArtifact(root,a.path,a.digest);verified[arm]=a.digest;
        return await probe(()=>spawn(binary,['rpc'],{shell:false,stdio:['pipe','pipe','pipe']}),options);
      } catch {return {outcome:'precondition',closed:true};}
    });
    report.verifiedArtifacts=verified;
  } catch {report={complete:false,outcome:'precondition'};}
  process.stdout.write(`${JSON.stringify(report)}\n`);process.exitCode=report.complete?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(await realpath(process.argv[1])).href) await main();
