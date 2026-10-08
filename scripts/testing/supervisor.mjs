// One owner for all application-test children, resource limits and cleanup.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {OwnedBuildTree} from '../owned-test-process-tree.mjs';

export function describeFailure(error) {
  const frames=String(error?.stack ?? '').split('\n').filter(line=>line.trimStart().startsWith('at '))
    .map(line=>line.match(/([^/\s():]+\.m?js:\d+:\d+)\)?$/)?.[1]).filter(Boolean).slice(0,4);
  const code=['HARNESS_SAMPLING_GAP','HARNESS_CLEANUP_TIMEOUT','BB_PROCESS_SNAPSHOT_FORMAT','ENOENT','EACCES','EPIPE'].includes(error?.code)?error.code:null;
  return {...(String(error?.cmd??'').startsWith('/bin/ps ')?{processSnapshotFailure:{killed:!!error.killed,signal:error.signal??null,exitCode:error.code??null}}:{}),errorClass:['Error','AssertionError','TypeError','RangeError','SyntaxError'].includes(error?.name)?error.name:'Error',code,frames,...(code==='BB_PROCESS_SNAPSHOT_FORMAT'?{snapshotFieldCount:error.snapshotFieldCount,snapshotRow:error.snapshotRow}: {})};
}

export class Supervisor {
  constructor({deadlineMs=540000,rssLimitKiB=4194304,report}) {
    this.deadlineMs=deadlineMs;this.rssLimitKiB=rssLimitKiB;this.report=report;
    this.started=performance.now();this.children=[];this.pending=Promise.resolve();this.closed=false;
    Object.assign(report,{deadlineMs,rssLimitKiB,peakTreeRSSKiB:0,rssSamples:[],failures:[],children:[]});
    this.timer=setTimeout(()=>this.fail('deadline'),deadlineMs);
    this.signals=['SIGINT','SIGTERM'].map(signal=>{const fn=()=>this.fail(signal);process.on(signal,fn);return [signal,fn];});
    this.schedule();
  }
  fail(stage,error) {
    if(this.report.failures.length)return;
    this.report.failures.push({stage,...(error?describeFailure(error):{})});
    for(const child of this.children) child.tree.signalRemembered('SIGKILL');
  }
  schedule() {
    this.sampler=setTimeout(()=>{this.pending=this.sample();},1000);
  }
  async sample() {
    try {
      const elapsedMs=Math.round(performance.now()-this.started);
      const previous=this.report.rssSamples.at(-1)?.elapsedMs ?? 0;
      if(elapsedMs-previous>10000)throw Object.assign(Error('Resource sampling missed deadline'),{code:'HARNESS_SAMPLING_GAP'});
      let rssKiB=Math.ceil(process.memoryUsage().rss/1024);
      const processes=[{role:'supervisor',pid:process.pid,ppid:process.ppid,rssKiB}];
      for(const child of this.children){
        const sample=await child.tree.sample();rssKiB+=sample.rssKiB;
        for(const {pid,ppid,rssKiB} of sample.members)processes.push({role:child.role,pid,ppid,rssKiB});
      }
      this.report.rssSamples.push({elapsedMs,rssKiB});
      if(rssKiB>this.report.peakTreeRSSKiB){
        this.report.peakTreeRSSKiB=rssKiB;
        this.report.peakMemory={elapsedMs,processes};
      }
      if(rssKiB>=this.rssLimitKiB)this.fail('memory-limit');
    }catch(error){this.fail('resource-sampling',error);}
    if(!this.closed && !this.report.failures.length)this.schedule();
  }
  start(role,command,args,{cwd,env,input,onRecord=()=>{}}) {
    assert(!this.closed && !this.report.failures.length,'Supervisor already failed or closed');
    assert(path.isAbsolute(command));assert(!this.children.some(child=>child.role===role));
    const child=spawn(command,args,{cwd,env,detached:true,stdio:['pipe','pipe','ignore']});
    const outcome={role,code:null,signal:null};this.report.children.push(outcome);
    let tree;
    if(Number.isSafeInteger(child.pid)){tree=new OwnedBuildTree(child.pid);this.children.push({role,child,tree,outcome});}
    let text='',bytes=0;
    child.stdout.on('data',chunk=>{
      if(this.report.failures.length)return;
      bytes+=chunk.length;if(bytes>65536){this.fail(role+'-output-limit');return;}
      text+=chunk.toString();let end;
      while((end=text.indexOf('\n'))>=0){
        const line=text.slice(0,end);text=text.slice(end+1);
        try {const record=JSON.parse(line);onRecord(record);}
        catch(error){this.fail(role+'-output',error);return;}
      }
    });
    child.stdin.on('error',error=>this.fail(role+'-input',error));
    child.stdin.end(input===undefined?'':JSON.stringify(input));
    return new Promise(resolve=>{
      child.once('error',error=>{outcome.failure=describeFailure(error);this.fail(role+'-spawn',error);resolve(outcome);});
      child.once('close',(code,signal)=>{
        Object.assign(outcome,{code,signal});
        if(text.trim())this.fail(role+'-incomplete-output');
        if(code!==0)this.fail(role+'-exit');
        resolve(outcome);
      });
    });
  }
  async close() {
    this.closed=true;clearTimeout(this.timer);clearTimeout(this.sampler);await this.pending;
    for(const [signal,fn]of this.signals)process.removeListener(signal,fn);
    // Preserve command outcomes even if cleanup fails. Never turn cleanup failure into success.
    for(const child of this.children){
      try {await child.tree.cleanup();child.outcome.cleanupComplete=true;}
      catch(error){child.outcome.cleanupComplete=false;this.report.failures.push({stage:child.role+'-cleanup',...describeFailure(error)});}
    }
    this.report.elapsedMs=Math.round(performance.now()-this.started);
    this.report.ownedTreeAbsent=this.children.every(child=>child.outcome.cleanupComplete===true);
    if(this.report.elapsedMs>this.deadlineMs)this.fail('deadline');
  }
}
