// Owned child-process supervision shared by local test runners. No build dependencies.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function parseProcessSnapshot(stdout){
  const members=[];
  for(const line of stdout.trim().split('\n')){
    const fields=line.trim().split(/\s+/);
    if(fields.length!==10)throw Object.assign(new Error('Process snapshot row has incomplete fields'),{code:'BB_PROCESS_SNAPSHOT_FORMAT'});
    const [pid,ppid,group,rss]=fields.slice(0,4).map(Number);
    if(![pid,ppid,group,rss].every(Number.isSafeInteger)||rss<0)throw Object.assign(new Error('Process snapshot row has invalid counters'),{code:'BB_PROCESS_SNAPSHOT_FORMAT'});
    members.push({pid,ppid,group,rssKiB:rss,started:fields.slice(4,9).join(' '),state:fields[9]});
  }
  return members;
}
export async function readProcessSnapshot(read=()=>execFileAsync('/bin/ps',['-axo','pid=,ppid=,pgid=,rss=,lstart=,stat='],{timeout:2000,maxBuffer:4*1024*1024,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}})){
  // A process can disappear while ps reads its counters. Retry one inconsistent
  // snapshot or interrupted reader in full; never omit a malformed row or invent resource data.
  for(let attempt=0;attempt<2;attempt++){
    try { const {stdout}=await read();return parseProcessSnapshot(stdout); }
    catch(error){
      const transient=error.code==='BB_PROCESS_SNAPSHOT_FORMAT'||error.killed===true||error.signal==='SIGPIPE';
      if(!transient||attempt===1)throw error;
    }
  }
}
function signalOwned(id,signal){
  try{process.kill(id,signal);}catch(error){if(!['ESRCH','EPERM'].includes(error.code))throw error;}
}
// Narrow build supervision seam used by the real stage runner and actual-process regression.
export class OwnedBuildTree {
  constructor(rootPid,{snapshot=readProcessSnapshot}={}){
    assert(Number.isSafeInteger(rootPid)&&rootPid>1);this.rootPid=rootPid;this.snapshot=snapshot;
    this.known=new Map();this.ownedGroups=new Set([rootPid]);this.members=[];this.seeded=false;
  }
  async sample(){
    const rows=await this.snapshot(),byPid=new Map(rows.map(row=>[row.pid,row]));
    if(!this.seeded){const root=byPid.get(this.rootPid);if(root){this.known.set(root.pid,root.started);this.seeded=true;}}
    const owned=new Set(rows.filter(row=>this.known.get(row.pid)===row.started).map(row=>row.pid));
    // A group can outlive its leader. Preserve it across reparenting, but reject an observed
    // reused leader PID rather than adopting an unrelated process that happens to reuse its number.
    const liveGroups=new Set();
    for(const group of this.ownedGroups){
      const leader=byPid.get(group),identity=this.known.get(group);
      if(leader&&identity&&leader.started!==identity){this.ownedGroups.delete(group);continue;}
      liveGroups.add(group);
    }
    let changed=true;
    while(changed){changed=false;
      for(const row of rows)if(!owned.has(row.pid)&&(owned.has(row.ppid)||liveGroups.has(row.group))){
        owned.add(row.pid);this.known.set(row.pid,row.started);changed=true;
        if(row.pid===row.group){this.ownedGroups.add(row.group);liveGroups.add(row.group);}
      }
    }
    this.members=rows.filter(row=>owned.has(row.pid));
    for(const row of this.members)if(row.pid===row.group)this.ownedGroups.add(row.group);
    return {members:this.members,rssKiB:this.members.reduce((sum,row)=>sum+row.rssKiB,0)};
  }
  signalRemembered(signal){
    // Stage roots are freshly spawned detached children; before first ps they are the only known group.
    const groups=new Set(this.members.filter(row=>this.ownedGroups.has(row.group)).map(row=>row.group));
    if(!this.seeded)groups.add(this.rootPid);
    for(const group of groups)signalOwned(-group,signal);
    for(const row of this.members)signalOwned(row.pid,signal);
  }
  async cleanup(){
    // Always terminate remembered children even if the diagnostic read fails
    // after freezing them. Otherwise the parent can wait forever on stopped work.
    this.signalRemembered('SIGSTOP');
    try{
      for(let i=0;i<3;i++){
        const {members}=await this.sample();if(members.length===0)return;
        this.signalRemembered('SIGSTOP');
      }
    }catch{/* Fresh verification below is still required before claiming cleanup. */}
    finally{this.signalRemembered('SIGKILL');}
    const end=Date.now()+5000;let lastError;
    while(Date.now()<end){
      try{const {members}=await this.sample();if(members.length===0)return;lastError=null;}
      catch(error){lastError=error;}
      this.signalRemembered('SIGKILL');await sleep(100);
    }
    if(lastError)throw lastError;
    assert.equal((await this.sample()).members.length,0,'Owned build descendants remain');
  }
}
