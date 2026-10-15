// Pure wallet-local replay. This does not authenticate an event's encrypted-log
// provenance, recipient, canonical inclusion or the supplied head. The caller
// must establish those facts through the trusted scoped PXE and retained chain.
// Full replay uses memory proportional to history; it is not bounded SDK paging.
import {FIELD_MODULUS} from './invocation.mjs';

export const PREFERENCE_DOMAIN = 0x52435031;
export const PREFERENCE_KINDS = Object.freeze({bookmark:1,followBoard:2,followName:3,subscription:4,replyNotifications:5,read:6});
const U64_MAX = (1n << 64n) - 1n;
const invalid = () => Object.assign(new Error('Private preference history is invalid or unavailable.'), {code:'ROLLING_PREFERENCES_INVALID'});
const check = value => { if (!value) throw invalid(); };

function record(input, keys) {
  check(input !== null && typeof input === 'object');
  const proto = Object.getPrototypeOf(input);
  check(proto === Object.prototype || proto === null);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const actual = Reflect.ownKeys(descriptors);
  check(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key)));
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    check(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable);
    result[key] = descriptor.value;
  }
  return result;
}
function decimal(value, max, nonzero=false) {
  check(typeof value === 'string' && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value));
  const n = BigInt(value);
  check(n <= max && (!nonzero || n !== 0n));
  return value;
}
const field = (value, nonzero=false) => decimal(value, FIELD_MODULUS - 1n, nonzero);
const integer = (value, max) => { check(Number.isSafeInteger(value) && value >= 0 && !Object.is(value,-0) && value <= max); return value; };
function eventRecord(input) {
  const e = record(input, ['schema','revision','kind','target','value','read_block','read_hash','previous_digest']);
  check(e.schema === 1);
  decimal(e.revision, U64_MAX, true); integer(e.kind, 6); check(e.kind >= 1);
  field(e.target); check(typeof e.value === 'boolean'); integer(e.read_block, 0xffffffff);
  field(e.read_hash); field(e.previous_digest);
  if (e.kind === 6) {
    check(e.target !== '0' && e.value && e.read_hash !== '0');
  } else {
    check(e.read_block === 0 && e.read_hash === '0');
    if (e.kind === 5) check(e.target === '0');
    else if (e.kind !== 2) check(e.target !== '0');
  }
  return Object.freeze(e);
}
function scopeRecord(input) {
  const scope = record(input, ['chainId','version','board']);
  for (const key of ['chainId','version','board']) field(scope[key], true);
  return Object.freeze(scope);
}
function headRecord(input) {
  const head = record(input, ['initialized','schema','revision','digest']);
  check(typeof head.initialized === 'boolean' && head.schema === 1);
  decimal(head.revision, U64_MAX); field(head.digest);
  check(head.initialized ? head.revision !== '0' && head.digest !== '0' : head.revision === '0' && head.digest === '0');
  return Object.freeze(head);
}
function snapshot(input) {
  const options = record(input, ['scope','head','events','hash']);
  check(typeof options.hash === 'function');
  const scope = scopeRecord(options.scope), head = headRecord(options.head);
  check(Array.isArray(options.events));
  const descriptors = Object.getOwnPropertyDescriptors(options.events);
  const length = descriptors.length?.value;
  check(Number.isSafeInteger(length) && length >= 0 && Reflect.ownKeys(descriptors).length === length + 1);
  // Complete revision 1..head is required. No implicit sorting, deduplication,
  // partial-history fallback or arbitrary maximum number of user preferences.
  check(BigInt(length) === BigInt(head.revision));
  const events = [];
  for (let i=0;i<length;i++) {
    const descriptor = descriptors[String(i)];
    check(descriptor && Object.hasOwn(descriptor,'value') && descriptor.enumerable);
    const e = eventRecord(descriptor.value);
    check(BigInt(e.revision) === BigInt(i) + 1n);
    events.push(e);
  }
  return {scope:Object.freeze(scope),head:Object.freeze(head),events,hash:options.hash};
}
const sorted = values => Object.freeze([...values].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));

/**
 * All field values, scope values and revisions are canonical decimal strings;
 * schema/kind/read_block are bounded JS integers, value/initialized are booleans.
 * hash(bigint[11], domain:number) must resolve to a canonical bigint field, e.g.
 * (fields, domain) => sdk.poseidon2HashWithSeparator(fields,domain).then(x=>x.toBigInt()).
 * No SDK import, private/public reader, network, storage or mutation occurs here.
 * Capture all records before invoking the asynchronous hash dependency.
 * Reply notifications default to true when no global choice was recorded;
 * this reversible UI default is overridden by an explicit false event. Read markers use the latest revision, even for an intentional earlier
 * block. Reorg recovery replays a replacement authenticated history/head afresh.
 */
export async function replayPreferenceEvents(input) {
  try {
    const {scope,head,events,hash} = snapshot(input);
    const state = emptyState();
    let digest = 0n;
    for (const e of events) {
      check(BigInt(e.previous_digest) === digest);
      digest = await eventDigest(scope,e,hash);
      applyEvent(state,e);
    }
    check(digest === BigInt(head.digest));
    return result(scope,head,state);
  } catch {
    // No caller-provided strings, accessor errors or hash dependency causes leak.
    throw invalid();
  }
}

// Shared by full replay and the bounded fold: there is only one digest encoding
// and one interpretation of toggles/read-marker replacement.
async function eventDigest(scope,e,hash) {
  const preimage = Object.freeze([BigInt(scope.chainId),BigInt(scope.version),BigInt(scope.board),
    BigInt(e.schema),BigInt(e.revision),BigInt(e.kind),BigInt(e.target),e.value ? 1n : 0n,
    BigInt(e.read_block),BigInt(e.read_hash),BigInt(e.previous_digest)]);
  const digest = await hash(preimage,PREFERENCE_DOMAIN);
  check(typeof digest === 'bigint' && digest > 0n && digest < FIELD_MODULUS);
  return digest;
}
function emptyState() {
  return {sets:[null,new Set(),new Set(),new Set(),new Set()],replyNotifications:true,readMarkers:new Map()};
}
function applyEvent(state,e) {
  if (e.kind <= 4) { if (e.value) state.sets[e.kind].add(e.target); else state.sets[e.kind].delete(e.target); }
  else if (e.kind === 5) state.replyNotifications = e.value;
  else state.readMarkers.set(e.target,Object.freeze({thread:e.target,throughBlock:e.read_block,blockHash:e.read_hash}));
}
function result(scope,head,state) {
  return Object.freeze({scope,head,bookmarks:sorted(state.sets[1]),followedBoards:sorted(state.sets[2]),
    followedNames:sorted(state.sets[3]),subscriptions:sorted(state.sets[4]),replyNotifications:state.replyNotifications,
    readMarkers:Object.freeze(sorted(state.readMarkers.keys()).map(id=>state.readMarkers.get(id)))});
}

// Per-call work limit, not a total feature/history count limit. Reversible
// engineering default pending the separate genuine capacity measurements.
export const PREFERENCE_FOLD_BATCH_LIMIT = 512;
const PREFIX_FORMAT = 'ROLLING_PREFERENCE_PREFIX_V1';
const SET_NAMES = ['bookmarks','followedBoards','followedNames','subscriptions'];
function arraySnapshot(input,convert,maximum=Infinity) {
  check(Array.isArray(input));
  const length = Object.getOwnPropertyDescriptor(input,'length')?.value;
  check(Number.isSafeInteger(length) && length >= 0 && length <= maximum);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  check(Reflect.ownKeys(descriptors).length === length + 1);
  const values = [];
  for (let i=0;i<length;i++) {
    const descriptor = descriptors[String(i)];
    check(descriptor && Object.hasOwn(descriptor,'value') && descriptor.enumerable);
    values.push(convert(descriptor.value,i));
  }
  return Object.freeze(values);
}
function ascending(values,key=x=>x) {
  for (let i=1;i<values.length;i++) check(BigInt(key(values[i-1])) < BigInt(key(values[i])));
}
function prefixSnapshot(input,scope,head) {
  const p = record(input,['format','scope','head',...SET_NAMES,'replyNotifications','readMarkers']);
  check(p.format === PREFIX_FORMAT);
  p.scope = scopeRecord(p.scope); p.head = headRecord(p.head);
  for (const key of ['chainId','version','board']) check(p.scope[key] === scope[key]);
  check(BigInt(p.head.revision) <= BigInt(head.revision));
  if (p.head.revision === head.revision) check(p.head.digest === head.digest);
  let minimumEvents = 0n;
  for (const key of SET_NAMES) {
    p[key] = arraySnapshot(p[key],id=>field(id,key !== 'followedBoards'));
    ascending(p[key]); minimumEvents += BigInt(p[key].length);
  }
  check(typeof p.replyNotifications === 'boolean');
  if (!p.replyNotifications) minimumEvents++;
  p.readMarkers = arraySnapshot(p.readMarkers,value=>{
    const marker = record(value,['thread','throughBlock','blockHash']);
    field(marker.thread,true); integer(marker.throughBlock,0xffffffff); field(marker.blockHash,true);
    return Object.freeze(marker);
  });
  ascending(p.readMarkers,marker=>marker.thread); minimumEvents += BigInt(p.readMarkers.length);
  check(minimumEvents <= BigInt(p.head.revision));
  return Object.freeze(p);
}
function foldOptions(input,resume=false) {
  const options = record(input,resume ? ['scope','head','hash','prefix','verifyAuthenticatedPrefix'] : ['scope','head','hash']);
  check(typeof options.hash === 'function');
  const scope = scopeRecord(options.scope), head = headRecord(options.head);
  if (!resume) return {scope,head,hash:options.hash};
  check(typeof options.verifyAuthenticatedPrefix === 'function');
  return {scope,head,hash:options.hash,prefix:prefixSnapshot(options.prefix,scope,head),verify:options.verifyAuthenticatedPrefix};
}
function fold({scope,head,hash,prefix}) {
  const state = emptyState();
  let revision = 0n, digest = 0n, busy = false, poisoned = false, finished = false;
  if (prefix) {
    for (let i=0;i<SET_NAMES.length;i++) state.sets[i+1] = new Set(prefix[SET_NAMES[i]]);
    state.replyNotifications = prefix.replyNotifications;
    state.readMarkers = new Map(prefix.readMarkers.map(marker=>[marker.thread,marker]));
    revision = BigInt(prefix.head.revision); digest = BigInt(prefix.head.digest);
    prefix = undefined; // Do not retain superseded checkpoint arrays alongside current state.
  }
  const ready = () => check(!busy && !poisoned && !finished);
  const currentHead = () => Object.freeze({initialized:revision>0n,schema:1,revision:String(revision),digest:String(digest)});
  const fail = () => { poisoned = true; throw invalid(); };
  return Object.freeze({
    async append(input) {
      let entered = false;
      try {
        ready(); busy = true; entered = true;
        // Entire bounded batch is captured/validated before the first hash await.
        const events = arraySnapshot(input,eventRecord,PREFERENCE_FOLD_BATCH_LIMIT);
        check(revision + BigInt(events.length) <= BigInt(head.revision));
        for (let i=0;i<events.length;i++) check(BigInt(events[i].revision) === revision + BigInt(i) + 1n);
        for (const e of events) {
          check(!poisoned && BigInt(e.previous_digest) === digest);
          const next = await eventDigest(scope,e,hash);
          // A concurrent append/checkpoint/finish poisons BOTH callers. Retain
          // ownership of the original hash until it settles; never detach work.
          check(!poisoned);
          applyEvent(state,e); digest = next; revision++;
        }
        if (revision === BigInt(head.revision)) check(digest === BigInt(head.digest));
        return Object.freeze({revision:String(revision),digest:String(digest)});
      } catch { return fail(); }
      finally { if (entered) busy = false; }
    },
    checkpoint() {
      try { ready(); return Object.freeze({format:PREFIX_FORMAT,...result(scope,currentHead(),state)}); }
      catch { return fail(); }
    },
    finish() {
      try {
        ready(); check(revision === BigInt(head.revision) && digest === BigInt(head.digest));
        const completed = result(scope,head,state); finished = true; return completed;
      } catch { return fail(); }
    },
  });
}

/**
 * Create a pure prefix fold. append(events) consumes at most 512 events in their
 * authenticated order; it returns ONLY revision/digest, never a partial result.
 * checkpoint() returns a detached, frozen PORTABLE PRIVATE PREFIX, not proof of
 * completeness/authenticity and not a result suitable for UI publication.
 * finish() alone returns the full-replay result shape after exact target-head
 * verification. Any error/overlap poisons this instance; restart explicitly.
 * Memory is O(current relationships/read markers + one bounded event batch),
 * not O(historical events). Snapshot/export copying is O(current state), with
 * no arbitrary total feature cap. No persistence, network or SDK IO is owned.
 * Authenticated event provenance/head/recipient and canonical continuity remain
 * caller obligations, as with replayPreferenceEvents. A reorg requires an
 * explicitly authenticated ancestor prefix or a fresh fold, never retargeting.
 */
export function createPreferenceFold(input) {
  try { return fold(foldOptions(input)); } catch { throw invalid(); }
}

/**
 * SECURITY BOUNDARY: verifyAuthenticatedPrefix(frozenPrefix) is REQUIRED and
 * trusted code, never default-true, a UI callback or a digest-only check. Its
 * closure must bind EXACTLY this previously verified prefix to the successfully
 * AEAD-decrypted CAS record, private owner/account/class/domain scope and a still
 * canonical checkpoint/anchor. This module cannot authenticate those facts.
 * Matching revision/digest DOES NOT authenticate arbitrary derived sets.
 * A plain JSON checkpoint, or accepting an attacker-supplied prefix because its
 * digest matches the head, is unsafe. Scope/shape checks below only reject
 * malformed input. The verifier must return exactly true, otherwise no fold is
 * created. All inputs/capabilities are captured before its asynchronous call.
 * The returned fold may extend the authenticated prefix to the captured head;
 * no old events or serialized history are retained.
 */
export async function resumePreferenceFold(input) {
  try {
    const options = foldOptions(input,true);
    check(await options.verify(options.prefix) === true);
    return fold(options);
  } catch { throw invalid(); }
}
