import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReliability,nextAlertState,SERVICES} from './monitor.mjs';
import {externalMonitorTemplate} from './external-stack.mjs';
const now=Date.parse('2026-10-28T12:00:00Z'),at=new Date(now).toISOString();
const host=role=>({schemaVersion:1,role,observedAt:at,services:Object.fromEntries(SERVICES[role].map(name=>[name,{active:true,running:true,restarts:0}])),metrics:{cpuPercent:20,memoryPercent:30,diskPercent:40},health:Object.fromEntries((role==='core'?['prover','query','moderator','funding']:['bok']).map(name=>[name,{status:'healthy'}]))});
const good=()=>({now,hosts:{core:host('core'),bok:host('bok')},external:{schemaVersion:1,observedAt:at,website:{ok:true,latencyMs:10},prover:{ok:true,latencyMs:20},feed:{ok:true,latencyMs:30}},spending:{observedAt:at,limitUsd:50,forecastUsd:5,incurredUsd:0},backup:{lastSuccessAt:at,lastVerifiedRestoreAt:at}});
test('healthy state needs current observations across all dependencies',()=>{
 assert.equal(buildReliability(good()).status,'healthy');
 const result=buildReliability({now});assert.equal(result.status,'unknown');assert(result.checks.every(x=>x.status==='unknown'));
});
test('stale or future health cannot remain green or expose stale counters',()=>{
 for(const observedAt of [new Date(now-180001).toISOString(),new Date(now+30001).toISOString(),'not a time']){
  const input=good();input.hosts.core.observedAt=observedAt;input.hosts.core.health.prover.completed=100;
  const result=buildReliability(input);assert.equal(result.hosts.core.fresh,false);assert.equal(result.hosts.core.metrics.cpuPercent,null);assert.equal(result.hosts.core.health.prover.completed,undefined);assert.equal(result.status,'unknown');
 }
});
test('projection drops all unknown text and identifiers',()=>{
 const input=good();input.hosts.core.secret='SENTINEL';input.hosts.core.health.prover.error='SENTINEL';input.hosts.core.services['board-prover'].command='SENTINEL';input.external.website.body='SENTINEL';input.spending.account='SENTINEL';
 assert(!JSON.stringify(buildReliability(input)).includes('SENTINEL'));
});
test('running process does not hide degraded work, low liquidity or full disk',()=>{
 const input=good();input.hosts.core.health.moderator.status='critical';input.hosts.core.metrics.diskPercent=96;input.hosts.core.health.funding={status:'healthy',feeBalance:1,minimumFeeBalance:2};
 const result=buildReliability(input);assert.equal(result.status,'critical');
 assert.deepEqual(result.checks.filter(x=>x.status==='critical').map(x=>x.id),['core.diskPercent','core.moderator.health','core.funding.liquidity']);
});
test('missing numeric values remain unknown; spend forecasts expire',()=>{
 const input=good();input.hosts.core.metrics.cpuPercent=NaN;input.spending.observedAt=new Date(now-49*3600000).toISOString();
 const result=buildReliability(input);assert.equal(result.hosts.core.metrics.cpuPercent,null);assert.equal(result.spending.forecastUsd,null);assert.equal(result.checks.find(x=>x.id==='spending').status,'unknown');
});
test('alerts debounce, deduplicate, escalate and recover with no source text',()=>{
 const run=(state,status)=>nextAlertState(state,[{id:'core.prover.health',status,error:'PRIVATE_SENTINEL'}],{now});
 let result=run({},'warning');assert.equal(result.notifications.length,0);
 result=run(result.state,'warning');assert.equal(result.notifications[0].kind,'incident');assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
 result=run(result.state,'warning');assert.equal(result.notifications.length,0);
 result=run(result.state,'critical');assert.equal(result.notifications.length,0);
 result=run(result.state,'critical');assert.equal(result.notifications[0].kind,'escalated');
 result=run(result.state,'healthy');assert.equal(result.notifications.length,0);
 result=run(result.state,'healthy');assert.equal(result.notifications[0].kind,'recovered');
 result=run(result.state,'healthy');assert.equal(result.notifications.length,0);
});
test('initial healthy observations never send recovery messages',()=>{
 let result=nextAlertState({},[{id:'external.website',status:'healthy'}],{now});
 result=nextAlertState(result.state,[{id:'external.website',status:'healthy'}],{now});assert.equal(result.notifications.length,0);
});
test('arbitrary diagnostic identifiers cannot enter alert messages',()=>{
 assert.equal(nextAlertState({},[{id:'core.PRIVATE_SENTINEL',status:'critical'}],{now,consecutive:1}).notifications.length,0);
});
test('notification limit delays undelivered changes without losing them',()=>{
 const checks=[{id:'external.website',status:'critical'},{id:'external.prover',status:'critical'}];
 let result=nextAlertState({},checks,{now,consecutive:1,maxNotifications:1});assert.equal(result.notifications.length,1);
 result=nextAlertState(result.state,checks,{now,consecutive:1,maxNotifications:1});assert.equal(result.notifications[0].id,'external.prover');
});
test('external monitoring has bounded schedule and no restart/deploy capabilities',()=>{
 const value=externalMonitorTemplate('def handler(event, context): pass'),r=value.Resources;
 assert.deepEqual(r.Schedule.Properties.EndDate,{Ref:'EndDate'});assert.equal(r.Probe.Properties.ReservedConcurrentExecutions,1);
 for(const name of ['WebsiteAlarm','ProverAlarm','FeedAlarm','HeartbeatAlarm']){assert.equal(r[name].Properties.TreatMissingData,'breaching');assert.equal(r[name].Properties.DatapointsToAlarm,2);}
 const statements=r.ProbeRole.Properties.Policies[0].PolicyDocument.Statement;
 const send=statements.find(s=>s.Action==='ssm:SendCommand');assert.equal(send.Resource.length,3);assert(JSON.stringify(send.Resource).includes('${HostDocument}'));
 assert.deepEqual(statements.map(s=>s.Action),['cloudwatch:PutMetricData','ssm:SendCommand','ssm:GetCommandInvocation','s3:PutObject']);
 assert.equal(r.HostDocument.Properties.Content.parameters,undefined);assert.equal(r.HostDocument.Properties.Content.mainSteps[0].inputs.runCommand[1],'exec /usr/bin/python3 /opt/rolling-ops/current/ops/host-observer.py --config /etc/rolling-ops/observer.json --state /var/lib/rolling-ops/cpu.json');
 assert.deepEqual(r.SnapshotBucket.Properties.PublicAccessBlockConfiguration,{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true});
 assert.equal(r.SnapshotBucket.Properties.LifecycleConfiguration.Rules[0].ExpirationInDays,2);
 assert.equal(r.Schedule.Properties.ScheduleExpression,'rate(2 minutes)');
 for(const name of ['CoreHostAlarm','BokHostAlarm'])assert.equal(r[name].Properties.TreatMissingData,'breaching');
});
test('unsupported optional measurements and initial CPU sample stay unknown without alerts',()=>{
 const input=good();delete input.hosts.core.metrics.cpuPercent;delete input.hosts.core.health.funding;delete input.spending;delete input.backup;
 const checks=buildReliability(input).checks;
 for(const id of ['core.cpuPercent','core.funding.health','spending','backup.freshness','backup.restore']){const check=checks.find(x=>x.id===id);assert.equal(check.status,'unknown');assert.equal(check.actionable,false);}
 let result=nextAlertState({},checks,{now});result=nextAlertState(result.state,checks,{now});assert.equal(result.notifications.length,0);
});
test('missing hosts alert once per host instead of every dependent measure',()=>{
 const checks=buildReliability({now}).checks;let result=nextAlertState({},checks,{now});result=nextAlertState(result.state,checks,{now});
 assert.deepEqual(result.notifications.map(x=>x.id),['core.observation','bok.observation','external.website','external.prover','external.feed']);
});
test('configured unavailable optional health alerts, and five-minute probes do not stale between runs',()=>{
 const input=good();input.hosts.core.health.funding={status:'unknown',configured:true};input.external.observedAt=new Date(now-600000).toISOString();
 let view=buildReliability(input);assert.equal(view.checks.find(x=>x.id==='external.website').status,'healthy');
 let result=nextAlertState({},view.checks,{now});result=nextAlertState(result.state,view.checks,{now});assert.deepEqual(result.notifications.map(x=>x.id),['core.funding.health']);
 input.external.observedAt=new Date(now-660001).toISOString();view=buildReliability(input);assert.equal(view.checks.find(x=>x.id==='external.website').status,'unknown');
});
