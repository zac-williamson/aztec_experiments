// TEST ONLY. Bounded in-process SDK observations, never a network/privacy claim.
import assert from 'node:assert/strict';
import {computeUniqueNoteHash, siloNoteHash, siloNullifier, computeSiloedPrivateInitializationNullifier, computeSiloedPublicInitializationNullifier} from '@aztec-labs/stdlib/hash';
import {MerkleTreeId} from '@aztec-labs/stdlib/trees';
import {PrivateExecutionOracle} from '@aztec-labs/pxe/simulator';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {NoteStatus} from '@aztec-labs/stdlib/note';
const roles = ['board-name', 'board-deposit', 'FPC-balance', 'Bok-balance'];
const phases = ['before-preflight', 'preflight', 'before-rollback', 'rollback', 'after-rollback-old-anchor', 'after-rollback', 'matching-post'];
const active = new WeakSet();
const contractRoles = ['board','FPC','Bok','owner-account','unknown'];
const initKinds = ['private-contract-init','public-contract-init','config-init','portal-init'];
const publicAnchor = value => {
  if (!value || typeof value !== 'object') return {unclassified: true};
  const number = Number(value.number), hash = String(value.hash);
  return Number.isSafeInteger(number) && number >= 0 && /^0x[0-9a-f]{64}$/.test(hash)
    ? {number, hash} : {unclassified: true};
};
export const createRollingNoteMembership = options => createRollingNoteMembershipFactory({computeUniqueNoteHash, siloNoteHash, siloNullifier, computeSiloedPrivateInitializationNullifier, computeSiloedPublicInitializationNullifier, poseidon2HashWithSeparator, oraclePrototype: PrivateExecutionOracle.prototype, nullifierTree: MerkleTreeId.NULLIFIER_TREE,
  noteTree: MerkleTreeId.NOTE_HASH_TREE, activeStatus: NoteStatus.ACTIVE})(options);

export function createRollingNoteMembershipFactory(sdk) {
  return ({node, wallet, owner, categories, contracts = [], maxRows = 128, maxLeaves = 256, maxNotes = 64}) => {
    assert.deepEqual(categories.map(item => item.role).sort(), [...roles].sort());
    for (const count of [maxRows,maxLeaves,maxNotes]) assert(Number.isSafeInteger(count) && count > 0 && count <= 256);
    assert(!active.has(node), 'Node membership observer already owned');
    const original = node.findLeavesIndexes, descriptor = Object.getOwnPropertyDescriptor(node, 'findLeavesIndexes');
    assert.equal(typeof original, 'function');
    assert(!descriptor || (descriptor.configurable && 'value' in descriptor), 'Cannot safely scope node method');
    assert(Array.isArray(contracts) && contracts.length <= 4);
    for (const item of contracts) assert(contractRoles.slice(0,-1).includes(item.role));
    assert(new Set(contracts.map(item => item.role)).size === contracts.length);
    const rows = [], captures = [], known = new Map(), knownNullifiers = new Map(), preflightReads = new Map(),
      missingNullifiers = [], oracleEvents = [], hashJobs = new Set(), oraclePatches = [];
    let initialized = false, preflightPassed = false, truncatedNullifiers = 0, truncatedOracles = 0;
    let phase = 'before-preflight', source = 'sdk', unknown = 0, truncatedRows = 0, truncatedLeaves = 0,
      truncatedNotes = 0, instrumentationErrors = 0, restored = false;
    const safe = fn => {try {return fn();} catch {instrumentationErrors++;}};
    const key = value => {const text = String(value); return /^0x[0-9a-f]{64}$/.test(text) ? text : undefined;};
    function begin(args) {
      if (rows.length >= maxRows) {truncatedRows++; return () => {};}
      const [anchor, tree, leaves] = args;
      if (!Number.isInteger(tree) || tree < 0 || tree > 4 || !Array.isArray(leaves)) {unknown++; return () => {};}
      const at = publicAnchor(anchor); if (at.unclassified) unknown++;
      const leafKeys = (tree === sdk.noteTree || tree === sdk.nullifierTree) ? leaves.slice(0,maxLeaves).map(key) : [];
      if (leaves.length > maxLeaves) truncatedLeaves += leaves.length - maxLeaves;
      const row = {phase, source, anchor: at, treeId: tree, count: leaves.length, outcome: 'pending', missing: []};
      rows.push(row);
      return (result, success) => {
        row.outcome = success ? 'returned' : 'failed';
        if (!success) return;
        if (!Array.isArray(result) || result.length !== leaves.length) {unknown++; row.outcome = 'unclassified-result'; return;}
        if (tree === sdk.nullifierTree && row.phase === 'preflight') for (let i = 0; i < Math.min(result.length,maxLeaves); i++) {
          if (leafKeys[i] && preflightReads.size < maxLeaves) preflightReads.set(leafKeys[i], !!result[i]);
          else truncatedNullifiers++;
        }
        for (let i = 0; i < Math.min(result.length,maxLeaves); i++) if (!result[i]) {
          const matches = tree === sdk.noteTree ? known.get(leafKeys[i]) ?? [] : [];
          row.missing.push({position: i, categories: Object.fromEntries(roles.map(role => [role,matches.some(item => item.role === role)])),
            matchedCapturedActiveNote: matches.length > 0,
            sourceEffectMembership: matches.some(item => item.sourceEffectMembership),
            sourceCanonicalAtCapture: matches.some(item => item.sourceCanonical),
            sourceAtOrBeforeAnchor: !at.unclassified && matches.some(item => item.sourceBlock <= at.number)});
          if (tree === sdk.nullifierTree) {
            if (missingNullifiers.length < maxLeaves) missingNullifiers.push({key: leafKeys[i], record: row.missing.at(-1), phase: row.phase});
            else truncatedNullifiers++;
          }
        }
      };
    }
    const roleOf = address => {const k=key(address); return k ? contracts.find(item => key(item.address) === k)?.role ?? 'unknown' : 'unknown';};
    function scheduleHash(event, address, inner) {
      // Store the computed private key only in this closure; never project it.
      const job = Promise.resolve().then(() => sdk.siloNullifier(address, inner))
        .then(value => {if (!restored) {event.key = key(value); if (!event.key) instrumentationErrors++;}}, () => {instrumentationErrors++;});
      hashJobs.add(job); job.finally(() => hashJobs.delete(job));
    }
    function installOracle(name) {
      const target = sdk.oraclePrototype;
      const before = Object.getOwnPropertyDescriptor(target, name);
      assert(before?.configurable && typeof before.value === 'function', 'Cannot safely scope oracle');
      const originalOracle = before.value;
      function observed(...args) {
        let event;
        safe(() => {
          if (oracleEvents.length >= maxRows * 4) {truncatedOracles++; return;}
          const address = name === 'isNullifierPending' ? args[1] : this.callContext.contractAddress;
          event = {phase, method: name, role: roleOf(address), outcome: 'pending', pending: null};
          oracleEvents.push(event); scheduleHash(event,address,args[0]);
        });
        const complete = (result, success) => safe(() => {
          if (!event) return;
          event.outcome = success ? 'returned' : 'failed';
          if (name === 'isNullifierPending' && success) {
            if (typeof result === 'boolean') event.pending = result; else {event.outcome = 'unclassified-result'; unknown++;}
          }
        });
        let result;
        try {result = Reflect.apply(originalOracle,this,args);} catch (error) {complete(undefined,false); throw error;}
        if (result instanceof Promise) Promise.prototype.then.call(result,value => complete(value,true),() => complete(undefined,false));
        else complete(result,true);
        return result;
      }
      Object.defineProperty(target,name,{...before,value:observed});
      oraclePatches.push({target,name,before,observed});
    }
    async function initializeNullifiers() {
      if (initialized) return; initialized = true;
      for (const item of contracts) {
        const add = (hash,kind) => {const k=key(hash); assert(k); const existing=knownNullifiers.get(k)??[]; knownNullifiers.set(k,[...existing,{role:item.role,kind}]);};
        const instance = await wallet.pxe.getContractInstance(item.address); // Local registered metadata only.
        assert(instance?.initializationHash, 'Local contract initialization metadata required');
        add(await sdk.computeSiloedPrivateInitializationNullifier(item.address,instance.initializationHash),'private-contract-init');
        add(await sdk.computeSiloedPublicInitializationNullifier(item.address),'public-contract-init');
        // Pinned aztec-nr initialization_utils.nr constant, public_immutable.nr:115.
        for (const [kind,slot] of [['config-init',item.configSlot],['portal-init',item.portalSlot]]) if (slot !== undefined) {
          add(await sdk.siloNullifier(item.address,await sdk.poseidon2HashWithSeparator([slot],1653084894)),kind);
        }
      }
    }
    const flush = async () => {while(hashJobs.size) await Promise.all([...hashJobs]);};
    function nullifierFacts() {
      for (const missing of missingNullifiers) {
        const matches = knownNullifiers.get(missing.key) ?? [];
        const events = oracleEvents.filter(event => missing.key && event.key === missing.key);
        missing.record.nullifier = {classified: !!missing.key, zero: missing.key === '0x'+'0'.repeat(64),
          nonzero: !!missing.key && missing.key !== '0x'+'0'.repeat(64),
          matchedSuccessfulPreflightRead: preflightPassed && preflightReads.has(missing.key),
          successfulPreflightReadFound: preflightPassed && preflightReads.get(missing.key) === true,
          initializationKinds: Object.fromEntries(initKinds.map(kind => [kind,matches.some(item=>item.kind===kind)])),
          contractRoles: Object.fromEntries(contractRoles.map(role=>[role,matches.some(item=>item.role===role)])),
          oracleMatch: events.length>0,
          oracleContractRoles: Object.fromEntries(contractRoles.map(role=>[role,events.some(event=>event.role===role)])),
          samePhasePendingTrue: events.some(event=>event.phase===missing.phase && event.method==='isNullifierPending' && event.pending===true),
          samePhasePendingFalse: events.some(event=>event.phase===missing.phase && event.method==='isNullifierPending' && event.pending===false),
          samePhaseCreated: events.some(event=>event.phase===missing.phase && event.method==='notifyCreatedNullifier' && event.outcome==='returned'),
        };
      }
    }
    function wrapped(...args) {
      const done = safe(() => begin(args));
      let result;
      try {result = Reflect.apply(original, this, args);} catch (error) {safe(() => done?.(undefined,false)); throw error;}
      if (result instanceof Promise) Promise.prototype.then.call(result,
        value => safe(() => done?.(value,true)), () => safe(() => done?.(undefined,false)));
      else safe(() => done?.(result,true));
      return result;
    }
    Object.defineProperty(node, 'findLeavesIndexes', {value: wrapped, writable: true, configurable: true,
      enumerable: descriptor?.enumerable ?? false});
    active.add(node);
    if (sdk.oraclePrototype) {
      let claimedOracle = false;
      try {
        assert(!active.has(sdk.oraclePrototype), 'Oracle observer already owned'); active.add(sdk.oraclePrototype); claimedOracle = true;
        installOracle('isNullifierPending'); installOracle('notifyCreatedNullifier');
      } catch (error) {
        for (const patch of oraclePatches.reverse()) Object.defineProperty(patch.target,patch.name,patch.before);
        if (claimedOracle) active.delete(sdk.oraclePrototype);
        if (descriptor) Object.defineProperty(node,'findLeavesIndexes',descriptor); else delete node.findLeavesIndexes;
        active.delete(node); throw error;
      }
    }
    const setPhase = value => {assert(phases.includes(value), 'Fixed diagnostic phase required'); phase = value;};
    async function capture(label, requestedAnchor) {
      setPhase(label); assert(captures.length < 8, 'Diagnostic capture bound');
      const record = {phase: label, outcome: 'running', categories: []}; captures.push(record);
      try {
        await initializeNullifiers();
        const header = await wallet.pxe.getSyncedBlockHeader();
        const anchor = requestedAnchor ?? {number: header.getBlockNumber(), hash: await header.hash()};
        record.anchor = publicAnchor(anchor); assert(!record.anchor.unclassified, 'Canonical anchor required');
        assert.equal(String((await node.getBlock(anchor.number)).hash), String(anchor.hash), 'Diagnostic anchor changed');
        for (const {role,contractAddress,storageSlot} of categories) {
          const all = await wallet.pxe.debug.getNotes({contractAddress, owner, status: sdk.activeStatus, scopes: [owner], storageSlot});
          assert(Array.isArray(all));
          truncatedNotes += Math.max(0,all.length-maxNotes);
          const category = {role,count: all.length,notes: []}; record.categories.push(category);
          for (const note of all.slice(0,maxNotes)) {
            const unique = await sdk.computeUniqueNoteHash(note.noteNonce, await sdk.siloNoteHash(note.contractAddress,note.noteHash));
            const hashKey = key(unique); assert(hashKey);
            const effect = await node.getTxEffect(note.txHash);
            const sourceBlock = Number(note.l2BlockNumber);
            const sourceCanonical = !!effect?.data && String(effect.data.txHash) === String(note.txHash) && Number(effect.l2BlockNumber) === sourceBlock
              && String(effect.l2BlockHash) === String(note.l2BlockHash)
              && String((await node.getBlock(sourceBlock))?.hash) === String(note.l2BlockHash);
            const sourceEffectMembership = !!effect?.data?.noteHashes.some(value => value.equals(unique));
            const facts = {role,sourceBlock,sourceCanonical,sourceEffectMembership};
            const previous = known.get(hashKey) ?? [];
            known.set(hashKey,[...previous.filter(item => item.role !== role),facts]);
            let pending;
            source = 'diagnostic';
            try {pending = node.findLeavesIndexes(anchor,sdk.noteTree,[unique]);} finally {source = 'sdk';}
            const membership = await pending;
            assert(Array.isArray(membership) && membership.length === 1);
            category.notes.push({present: !!membership[0],sourceCanonical,sourceEffectMembership,
              sourceAtOrBeforeAnchor: sourceBlock <= record.anchor.number});
          }
        }
        assert.equal(String((await node.getBlock(anchor.number)).hash), String(anchor.hash), 'Diagnostic anchor changed');
        record.outcome = 'complete'; return anchor;
      } catch (error) {record.outcome = 'failed'; throw error;}
    }
    function close() {
      if (restored) return;
      assert.equal(Object.getOwnPropertyDescriptor(node,'findLeavesIndexes')?.value,wrapped,'Node membership ownership changed');
      for (const patch of oraclePatches) assert.equal(Object.getOwnPropertyDescriptor(patch.target,patch.name)?.value,patch.observed,'Oracle ownership changed');
      nullifierFacts();
      for (const patch of oraclePatches) Object.defineProperty(patch.target,patch.name,patch.before);
      if (sdk.oraclePrototype) active.delete(sdk.oraclePrototype);
      if (descriptor) Object.defineProperty(node,'findLeavesIndexes',descriptor); else delete node.findLeavesIndexes;
      active.delete(node); restored = true; known.clear(); knownNullifiers.clear(); preflightReads.clear(); missingNullifiers.length=0;
      for (const event of oracleEvents) delete event.key;
    }
    return {setPhase,capture,close,flush,markPreflightSucceeded:()=>{assert.equal(phase,'preflight');preflightPassed=true;},snapshot: () => {
      if (!restored) nullifierFacts();
      return structuredClone({schema: 2,
      scope: 'in-process findLeavesIndexes and scoped private-nullifier oracle calls plus diagnostic membership reads; not network capture or anonymity evidence',
      interpretation: 'Unknown nullifiers are not proof of missing initialization or pending-read misclassification; initializerless accounts need no initialization marker; cache hits may bypass observation; matches are hypotheses, not causes',
      phases: rows,captures,oracleEvents: oracleEvents.map(({phase,method,role,outcome,pending})=>({phase,method,role,outcome,pending})),
      preflightPassed,unknown,truncatedRows,truncatedLeaves,truncatedNotes,truncatedNullifiers,truncatedOracles,instrumentationErrors,restored});}};
  };
}
