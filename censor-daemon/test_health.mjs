import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeModerationHealth,moderationFailure} from './health.mjs';
const status={checkpoint:{number:3,hash:'private-marker'},lastSuccessfulIngestAt:1000000,health:{retryableErrors:0,unresolvedSigning:0,manualSigningFences:0,awaitingFinality:0,expiredObligations:0,manualAttention:0,unsignedPending:0,earliestUnsignedDeadline:null}};
test('health output allowlists counts and omits all extra fields',()=>{const r=summarizeModerationHealth({status:{...status,secret:'SECRET',health:{...status.health,token:'SECRET'}},now:1000000});assert.equal(r.severity,'ok');assert.ok(!JSON.stringify(r).includes('SECRET'));assert.ok(!JSON.stringify(r).includes('private-marker'));});
test('ingestion age is measured and missing or future state fails closed',()=>{assert.equal(summarizeModerationHealth({status,now:1100000}).alerts[0].code,'INGESTION_STALE');assert.equal(summarizeModerationHealth({status:{...status,lastSuccessfulIngestAt:null},now:1000000}).alerts[0].code,'INGESTION_UNKNOWN');assert.deepEqual(summarizeModerationHealth({status,now:1}),moderationFailure());});
test('deadline boundary and included-awaiting-finality distinguish warning from failure',()=>{const s={...status,health:{...status.health,unsignedPending:1,earliestUnsignedDeadline:'1300'}};assert.equal(summarizeModerationHealth({status:s,now:1000000}).alerts[0].code,'DEADLINE_APPROACHING');s.health.earliestUnsignedDeadline='1301';assert.equal(summarizeModerationHealth({status:s,now:1000000}).severity,'ok');s.health.awaitingFinality=1;assert.equal(summarizeModerationHealth({status:s,now:1000000}).alerts[0].code,'AWAITING_FINALITY');});
test('known diagnostics are fixed classifications; arbitrary message/code never escape',async()=>{
 const {safeModerationDiagnostic}=await import('./health.mjs');
 assert.equal(safeModerationDiagnostic({code:'INVALID_VERDICT',message:'SECRET'}),'INVALID_VERDICT');
 assert.equal(safeModerationDiagnostic({code:'SECRET',message:'SECRET'}),'MODERATION_FAILED');
 assert.equal(safeModerationDiagnostic({message:'Historical policy unavailable'}),'POLICY_UNAVAILABLE');
 assert.equal(safeModerationDiagnostic({message:'Invalid historical policy SECRET'}),'MODERATION_FAILED');
 assert.ok(!JSON.stringify(moderationFailure({code:'SECRET',message:'SECRET'})).includes('SECRET'));
});
