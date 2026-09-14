// Owned child-process supervision shared by local test runners. No build dependencies.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function processSnapshot(){
  const {stdout}=await execFileAsync('/bin/ps',['-axo','pid=,ppid=,pgid=,rss=,lstart=,stat='],{timeout:2000,maxBuffer:4*1024*1024,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  const members=[];
  for(const line of stdout.trim().split('\n')){
    const fields=line.trim().split(/\s+/);assert(fields.length===10,'Unexpected ps format');
    const [pid,ppid,group,rss]=fields.slice(0,4).map(Number);
    assert([pid,ppid,group,rss].every(Number.isSafeInteger)&&rss>=0,'Invalid ps counters');
    members.push({pid,ppid,group,rssKiB:rss,started:fields.slice(4,9).join(' '),state:fields[9]});
  }
  return members;
}
function signalOwned(id,signal){
  try{process.kill(id,signal);}catch(error){if(!['ESRCH','EPERM'].includes(error.code))throw error;}
}
// Narrow build supervision seam used by the real stage runner and actual-process regression.
export class OwnedBuildTree {
  constructor(rootPid){
    assert(Number.isSafeInteger(rootPid)&&rootPid>1);this.rootPid=rootPid;
    this.known=new Map();this.ownedGroups=new Set([rootPid]);this.members=[];this.seeded=false;
  }
  async sample(){
    const rows=await processSnapshot(),byPid=new Map(rows.map(row=>[row.pid,row]));
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
    // Freeze before killing so Ninja cannot launch a replacement compiler during teardown.
    this.signalRemembered('SIGSTOP');
    for(let i=0;i<3;i++){
      const {members}=await this.sample();if(members.length===0)return;
      this.signalRemembered('SIGSTOP');
    }
    this.signalRemembered('SIGKILL');const end=Date.now()+5000;
    while(Date.now()<end){
      const {members}=await this.sample();if(members.length===0)return;
      this.signalRemembered('SIGKILL');await sleep(100);
    }
    assert.equal((await this.sample()).members.length,0,'Owned build descendants remain');
  }
}
