import {beginProofSpan} from '../shared/proof-timings.mjs';
import {createHash} from 'node:crypto';
import {ORDINARY_POST_GAS_PROFILE} from '../shared/ordinary-post-fees.mjs';
import {PXE_SOURCE_PINS} from './patch-pxe-operation-guards.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function replace(source,before,after){if(source.split(before).length!==2)throw Error('PXE validated proof boundary mismatch');return source.replace(before,after);}

// Build-time transforms for the pinned native SDK. The native queue still owns
// sync, anchor, staged writes, failure discard and final tagging persistence.
export function validatedPxeProve(source){
 if(sha(source)!==PXE_SOURCE_PINS.find(pin=>pin.path==='dest/pxe.js').sha256)throw Error('PXE validated proof source mismatch');
 source="import {DefaultAccountEntrypoint as SyncAccountEntrypoint} from '@aztec-labs/entrypoints/account';\nimport {EncodedAppEntrypointCalls as SyncEncodedCalls} from '@aztec-labs/entrypoints/encoding';\nimport {FunctionCall as SyncFunctionCall,FunctionSelector as SyncSelector,encodeArguments as syncEncodeArguments,decodeEachFromAbi as syncDecodeArguments,getAllFunctionAbis as syncFunctionAbis} from '@aztec-labs/stdlib/abi';\nimport {HashedValues as SyncHashedValues} from '@aztec-labs/stdlib/tx';\nimport {AztecAddress as SyncAddress} from '@aztec-labs/stdlib/aztec-address';\nimport {Fr as SyncFr} from '@aztec-labs/foundation/curves/bn254';\nimport {poseidon2HashWithSeparator as syncPoseidon,poseidon2Hash as syncAccountKeyHash,poseidon2HashBytes as syncAccountSlotHash} from '@aztec-labs/foundation/crypto/poseidon';\nimport {FactCollectionKey as SyncFactCollectionKey} from './storage/fact_store/fact_store_keys.js';\nimport {sha256ToField as syncSha256ToField} from '@aztec-labs/foundation/crypto/sha256';\nimport {computePublicDataTreeLeafSlot as syncPublicDataLeaf,siloNullifier as syncSiloNullifier} from '@aztec-labs/stdlib/hash';\nimport {BlockHash as SyncBlockHash} from '@aztec-labs/stdlib/block';\nimport {computeSiloedPrivateInitializationNullifier as syncInitializationNullifier} from '@aztec-labs/stdlib/hash';\nimport {MerkleTreeId as SyncTreeId} from '@aztec-labs/stdlib/trees';\nimport {CircuitKind} from '@aztec-foundation/bb.js';\n"+source;
 source=replace(source,'}, txRequest, privateExecutionResult) {\n        const { publicInputs, chonkProof, executionSteps, timings: { proving } = {} } = await this.#prove',`}, txRequest, privateExecutionResult, validatePublic = false) {
        let validationTime;
        const beforeProof = validatePublic ? async publicInputs => {
            const timer = new Timer();
            await this.#validateKernelPublicInputs(txRequest, privateExecutionResult, publicInputs);
            validationTime = timer.ms();
        } : undefined;
        const { publicInputs, chonkProof, executionSteps, timings: { proving } = {} } = await this.#prove`);
 source=replace(source,`            simulate: false,
            skipFeeEnforcement: false,
            profileMode: 'none'
        });`, `            simulate: false,
            skipFeeEnforcement: false,
            profileMode: 'none',
            beforeProof
        });`);
 source=replace(source,`            proving,
            perFunction,
            unaccounted: totalTime - ((syncTime ?? 0) + (proving ?? 0) + perFunction.reduce((acc, { time })=>acc + time, 0))`, `            proving,
            validation: validationTime,
            privateWitness: executionSteps.filter(step => step.kind === CircuitKind.App).reduce((total, step) => total + step.timings.witgen, 0),
            kernelWitness: executionSteps.filter(step => step.kind === CircuitKind.Kernel || step.kind === CircuitKind.HidingKernel).reduce((total, step) => total + step.timings.witgen, 0),
            perFunction,
            unaccounted: totalTime - ((syncTime ?? 0) + (proving ?? 0) + (validationTime ?? 0) + perFunction.reduce((acc, { time })=>acc + time, 0))`);
 source=replace(source,'    // Public API\n',`    // Exact pinned initializerless-account constructor semantics, without ACVM
    // or contract synchronization. Capsules are native non-block-anchored data.
    // The private account circuit independently checks this key's immutable
    // hash and signature on every use; this method grants no transaction right.
    async initializeSchnorrAccount(owner, signingPublicKey, {contextGuard} = {}) {
        const check=value=>{if(!value)throw new Error('Invalid initializerless account capsule');};
        check(typeof contextGuard==='function');
        const address=SyncAddress.fromStringUnsafe(owner.toString());
        const key=[SyncFr.fromString(signingPublicKey.x.toString()),SyncFr.fromString(signingPublicKey.y.toString())];
        return this.operationQueue.runSynced(async ({changeSetId})=>{
            await contextGuard();
            const accounts=await this.keyStore.getAccounts();
            check(accounts.some(account=>account.equals(address)));
            const instance=await this.contractStore.getContractInstance(address);
            const classId=SyncFr.fromString('${ORDINARY_POST_GAS_PROFILE.accountClassId}');
            check(instance && instance.originalContractClassId.equals(classId));
            check((await computeContractAddressFromInstance(instance)).equals(address));
            check((await syncAccountKeyHash(key)).equals(instance.immutablesHash));
            const slot=await syncAccountSlotHash(Buffer.from('INITIALIZERLESS_ACCOUNT_PUB_KEY'));
            const existing=await this.capsuleStore.getCapsule(address,slot,changeSetId,address);
            if(!existing || existing.length!==2 || !existing.every((value,index)=>value.equals(key[index]))) {
                await this.capsuleStore.setCapsule(address,slot,key,changeSetId,address);
            }
            await contextGuard();
        },{beforeCommit:contextGuard});
    }
    // Validate actual kernel output before expensive proof generation. No
    // synthetic kernel implementation or second private execution is involved.
    async #validateKernelPublicInputs(txRequest, privateExecutionResult, publicInputs) {
        const simulatedTx = await new PrivateSimulationResult(privateExecutionResult, publicInputs).toSimulatedTx();
        // Both checks consume the same detached transaction and are read-only.
        // Drain both before failing; native proof generation still starts only
        // after public execution, gas and admission have all succeeded.
        const results = await Promise.allSettled([
            () => publicInputs.forPublic ? this.#simulatePublicCalls(simulatedTx, false) : undefined,
            () => this.node.isValidTx(simulatedTx, {isSimulation: true, skipFeeEnforcement: false}),
        ].map(read => Promise.resolve().then(read)));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        const output = results[0].value;
        if (publicInputs.forPublic && (!output?.txEffect?.revertCode?.isOK() || output.revertReason)) {
            throw Object.assign(new Error('Transaction public validation failed'), {code:'BB_SIMULATION_FAILED'});
        }
        const gas = output?.gasUsed;
        const limits = txRequest.txContext.gasSettings;
        if (['daGas', 'l2Gas'].some(key => (gas?.totalGas ?? publicInputs.gasUsed)[key] > limits.gasLimits[key] || (gas?.teardownGas[key] ?? 0) > limits.teardownGasLimits[key])) {
            throw Object.assign(new Error('Transaction exceeds its fixed gas limits'), {code:'BB_GAS_LIMIT_EXCEEDED'});
        }
        const validation = results[1].value;
        if (validation.result !== 'valid') throw Object.assign(new Error('Transaction preflight validation failed'), {code:'BB_SIMULATION_FAILED'});
    }
    // Public API
`);
 source=replace(source,'    // Public API\n',`    // Explicit capability: old SDKs must not silently ignore validation.\n    proveTxWithPublicValidation(txRequest, options) {\n        return this.proveTx(txRequest, {...options, validatePublic: true});\n    }\n    // Public API\n`);
 source=replace(source,'*/ proveTx(txRequest, { scopes, senderForTags }) {',`*/ proveTx(txRequest, { scopes, senderForTags, validatePublic = false, preSyncCalls }) {
        if (typeof validatePublic !== 'boolean') throw new Error('Invalid public validation option');
        if (preSyncCalls !== undefined) {
            if (!validatePublic || !Array.isArray(preSyncCalls) || preSyncCalls.length !== 2) throw new Error('Invalid ordinary sync payload');
            // Detach the exact calls before the native operation queue can yield.
            preSyncCalls = preSyncCalls.map(call => SyncFunctionCall.from({name:call.name,
                to:SyncAddress.fromStringUnsafe(call.to.toString()),selector:SyncSelector.fromString(call.selector.toString()),
                type:call.type,hideMsgSender:call.hideMsgSender,isStatic:call.isStatic,
                args:call.args.map(value=>SyncFr.fromString(value.toString()))}));
        }`);
 source=replace(source,`            privateExecutionResult = await this.#executePrivate({
                contractFunctionSimulator,
                txRequest,
                anchorBlockHeader: ctx.anchorBlockHeader,`, `            if (preSyncCalls) await this.#syncOrdinaryPostCalls(txRequest, preSyncCalls, contractFunctionSimulator, ctx, scopes);
            privateExecutionResult = await this.#executePrivate({
                contractFunctionSimulator,
                txRequest,
                anchorBlockHeader: ctx.anchorBlockHeader,`);
 source=replace(source,'    // Public API\n',`    // Known ordinary calls enter the SAME native staged operation. They are
    // bound to the actual account request before any contract state is touched.
    // Native private execution and its normal sync checks still run once after.
    async #syncOrdinaryPostCalls(txRequest, calls, simulator, ctx, scopes) {
        const check=value=>{if(!value)throw new Error('Invalid ordinary sync payload');};
        const profile=${JSON.stringify(ORDINARY_POST_GAS_PROFILE)};
        check(calls[0].name==='pay_fee' && calls[1].name==='post' &&
            calls[0].selector.toString()==='0xc8772dde' && calls[1].selector.toString()===profile.postSelector &&
            calls.every(call=>call.type==='private' && call.hideMsgSender===false && call.isStatic===false));
        const abi=new SyncAccountEntrypoint(txRequest.origin, undefined).getEntrypointAbi();
        check(txRequest.functionSelector.equals(await SyncSelector.fromNameAndParameters(abi.name,abi.parameters)));
        const entries=txRequest.argsOfCalls.filter(args=>args.hash.equals(txRequest.firstCallArgsHash));
        check(entries.length===1);
        const entry=entries[0],decoded=syncDecodeArguments(abi.parameters.map(parameter=>parameter.type),entry.values);
        const encoded=await SyncEncodedCalls.create(calls,new SyncFr(decoded[0].tx_nonce));
        const fields=syncEncodeArguments(abi,[encoded,decoded[1],decoded[2]]);
        check(fields.length===entry.values.length && fields.every((value,index)=>value.equals(entry.values[index])) &&
            (await SyncHashedValues.fromArgs(fields)).hash.equals(txRequest.firstCallArgsHash));
        const targets=[{address:txRequest.origin,selector:txRequest.functionSelector,classId:profile.accountClassId},
            {address:calls[0].to,selector:calls[0].selector,classId:profile.privateFeeClassId},
            {address:calls[1].to,selector:calls[1].selector,classId:profile.boardClassId}];
        check(new Set(targets.map(target=>target.address.toString())).size===3);
        await this.#syncOrdinaryPostTargets(targets,simulator,ctx,scopes);
    }
    // Preparation and proof share only the native anchor-scoped contract cache.
    // A discarded operation or anchor change invalidates that cache normally.
    async #registeredSyncTarget(address,name,method) {
        const instance=await this.contractStore.getContractInstance(address);
        if(!instance || !(await computeContractAddressFromInstance(instance)).equals(address))throw new Error('Invalid registered sync preimage');
        const classId=instance.originalContractClassId.toString();
        if(name==='SchnorrInitializerlessAccount'&&classId!=='${ORDINARY_POST_GAS_PROFILE.accountClassId}')throw new Error('Invalid sync account class');
        const artifact=await this.contractStore.getContractArtifact(instance.originalContractClassId);
        if(artifact?.name!==name)throw new Error('Invalid registered sync artifact');
        let selector;
        if(method!==undefined){
            const matches=syncFunctionAbis(artifact).filter(fn=>fn.name===method);
            if(matches.length!==1||matches[0].functionType!=='private')throw new Error('Invalid registered sync ABI');
            selector=await SyncSelector.fromNameAndParameters(matches[0].name,matches[0].parameters);
        }
        return {address,classId,instance,artifact,selector};
    }
    async #syncOrdinaryPostTargets(targets, simulator, ctx, scopes) {
        const check=value=>{if(!value)throw new Error('Invalid ordinary sync class');};
        await allToCompletion(targets.map(async target=>check((await this.contractClassService.getCurrentClassId(target.address,ctx.anchorBlockHeader))?.toString()===target.classId)));
        await allToCompletion(targets.map(target=>this.contractSyncService.ensureContractSynced({
            contract:target.address,functionToInvokeAfterSync:target.selector,
            utilityExecutor:(call,execScopes)=>this.#executeUtility(simulator,call,[],execScopes,ctx.anchorBlockHeader,ctx.changeSetId),
            anchorBlockHeader:ctx.anchorBlockHeader,changeSetId:ctx.changeSetId,scopes,triggeredBy:undefined,
        })));
    }
    // Public API\n`);
 source=replace(source,'    // Public API\n',`    prepareOrdinaryPostState({owner,board,privateFee}) {
        return this.prepareBoardActionState({owner,board,privateFee,method:'post'});
    }
    // Public API\n`);
 source=replace(source,'    // Public API\n',`    prefetchBoardClaimWitnesses(board) {
        return this.#prefetchClaimImmutables(SyncAddress.fromStringUnsafe(board.toString()),undefined,'RollingBoard',
            [{slot:1n,length:1},{slot:3n,length:10}],{portal_address:1,config:3,deposits:14});
    }
    prefetchBokClaimWitnesses(bok, classId, owner) {
        const scope=SyncAddress.fromStringUnsafe(owner.toString());
        if(scope.equals(bok))throw new Error('Invalid Bok claim owner');
        return this.#prefetchClaimImmutables(SyncAddress.fromStringUnsafe(bok.toString()),SyncFr.fromString(classId.toString()).toString(),'PrivateBok',
            [{slot:7n,length:1},{slot:9n,length:1},{slot:11n,length:1}],{board:1,operator:3,owner:5,portal:7,l1_chain:9,version:11,balances:13},scope);
    }
    #prefetchClaimImmutables(address, expected, name, slots, layout, owner) {
        return this.operationQueue.runSynced(async ctx=>{
            expected ??= (await this.#registeredSyncTarget(address,name)).classId;
            const qualified=await allToCompletion([
                ()=>this.contractClassService.getCurrentClassId(address,ctx.anchorBlockHeader),
                ()=>this.contractStore.getContractArtifact(SyncFr.fromString(expected)),
                ...(owner?[()=>this.contractClassService.getCurrentClassId(owner,ctx.anchorBlockHeader)]:[]),
            ].map(read=>Promise.resolve().then(read)));
            const artifact=qualified[1];
            if(qualified[0]?.toString()!==expected || (owner && qualified[2]?.toString()!=='${ORDINARY_POST_GAS_PROFILE.accountClassId}') || artifact?.name!==name ||
                Object.entries(layout).some(([key,slot])=>!artifact.storageLayout?.[key]?.slot?.equals(new SyncFr(slot))))throw new Error('Invalid '+(name==='RollingBoard'?'Board':'Bok')+' claim layout');
            const anchor=await ctx.anchorBlockHeader.toBlockParameter();
            const type=syncSha256ToField(Buffer.from('AZTEC_NR::PUBLIC_IMMUTABLE_CACHE_TYPE_ID'));
            const valueType=syncSha256ToField(Buffer.from('AZTEC_NR::PUBLIC_IMMUTABLE_VALUE_READ'));
            const entries=await allToCompletion(slots.map(async entry=>{
                const collection=await this.factStore.getFactCollection(new SyncFactCollectionKey(address,{type:'public'},type,new SyncFr(entry.slot)),ctx.changeSetId);
                const fact=collection?.facts.find(fact=>fact.factTypeId.equals(valueType));
                return {...entry,hasValue:!!fact,needsInitialization:!fact || !fact.originBlock || fact.originBlock.blockNumber>ctx.anchorBlockHeader.getBlockNumber(),
                    nullifier:await syncSiloNullifier(address,await syncPoseidon([new SyncFr(entry.slot)],1653084894)),
                    leaf:await syncPublicDataLeaf(address,new SyncFr(entry.slot+BigInt(entry.length)))};
            }));
            // Native PublicImmutable remains the authority. Existing native facts
            // avoid packed-value reads; all historical hash proofs are still
            // required even when the immutable value has already been recorded.
            const nullifiers=entries.filter(entry=>entry.needsInitialization).map(entry=>entry.nullifier);
            const reads=[...(nullifiers.length?[()=>this.node.findLeavesIndexes(anchor,SyncTreeId.NULLIFIER_TREE,nullifiers)]:[]),
                ...entries.flatMap(entry=>[()=>this.node.getPublicDataWitness(anchor,entry.leaf),
                    ...(!entry.hasValue?Array.from({length:entry.length},(_,i)=>()=>this.node.getPublicStorageAt(anchor,address,new SyncFr(entry.slot+BigInt(i)))):[])])];
            // Claim execution requires this same owner-scoped native discovery.
            // Run it beside immutable reads; native rollback/discard owns its
            // staged notes and same-anchor ContractSyncService reuse.
            if(owner)reads.push(()=>this.#syncOrdinaryPostTargets([
                {address:owner,classId:'${ORDINARY_POST_GAS_PROFILE.accountClassId}'},
                {address,classId:expected},
            ],this.#getSimulatorForTx(),ctx,[owner]));
            await allToCompletion(reads.map(read=>Promise.resolve().then(read)));
        });
    }
    // Public API\n`);
 source=replace(source,'    // Public API\n',`    syncForAccountStatus(board, privateFee) {
        const address=SyncAddress.fromStringUnsafe(board.toString());
        return this.operationQueue.run(async()=>{
            const target=await this.#registeredSyncTarget(address,'RollingBoard');
            const instance=target.instance;
            let feeAddress;
            if(privateFee!==undefined){
                feeAddress=SyncAddress.fromStringUnsafe(privateFee.toString());
                if(feeAddress.equals(address))throw new Error('Invalid account status FPC');
                await this.#registeredSyncTarget(feeAddress,'PrivateFPC');
            }
            const nullifier=await syncInitializationNullifier(address,instance.initializationHash);
            // Public hash-pinned reads only. Native rollback/anchor selection
            // completes before any contract discovery or utility can consume them.
            await this.blockStateSynchronizer.syncWithAnchorRead(async selected=>{
                const anchor={number:selected.number,hash:SyncBlockHash.fromString(selected.hash)};
                await allToCompletion([
                    ()=>this.node.getContract(address,anchor),
                    // Public class only. Empty opening never discovers FPC notes.
                    ...(feeAddress?[()=>this.node.getContract(feeAddress,anchor)]:[]),
                    ()=>this.node.findLeavesIndexes(anchor,SyncTreeId.NULLIFIER_TREE,[nullifier]),
                ].map(read=>Promise.resolve().then(read)));
            },{warmNodeCache:true,snapshotAncestry:true});
        });
    }
    // Public API\n`);
 source=replace(source,'    // Public API\n',`    syncForOrdinaryPost({owner,board,privateFee},readPolicy) {
        const addresses=[owner,privateFee,board].map(value=>SyncAddress.fromStringUnsafe(value.toString()));
        if(typeof readPolicy!=='function'||new Set(addresses.map(value=>value.toString())).size!==3)throw new Error('Invalid ordinary sync targets');
        return this.operationQueue.run(async()=>{
            const targets=await allToCompletion(addresses.map((address,index)=>this.#registeredSyncTarget(address,['SchnorrInitializerlessAccount','PrivateFPC','RollingBoard'][index])));
            const instances=targets.map(target=>target.instance);
            const nullifier=await syncInitializationNullifier(targets[2].address,instances[2].initializationHash);
            return this.blockStateSynchronizer.syncWithAnchorRead(async selected=>{
                const anchor={number:selected.number,hash:SyncBlockHash.fromString(selected.hash)};
                const results=await allToCompletion([
                    ...targets.map(target=>()=>this.node.getContract(target.address,anchor)),
                    ()=>this.node.findLeavesIndexes(anchor,SyncTreeId.NULLIFIER_TREE,[nullifier]),
                    ()=>readPolicy(selected),
                ].map(read=>Promise.resolve().then(read)));
                return results[4];
            },{warmNodeCache:true});
        });
    }
    // Public API\n`);
 source=replace(source,'    // Public API\n',`    prepareBoardActionState({owner,board,privateFee,method,collateralOnly=false}) {
        // No posting gas/history assumptions. Resolve the actual named ABI from
        // the registered, class-pinned Board; these are state preparation only.
        const allowed=['post','post_thread','get_deposit_ids','register_name','set_bio','set_avatar','create_subboard','remove_post','remove_avatar','reject_subboard','set_main_policy','transfer_moderator','screen','withdraw'];
        if(!allowed.includes(method)||typeof collateralOnly!=='boolean'||collateralOnly&&method!=='get_deposit_ids')throw new Error('Invalid Board state method');
        const addresses=[owner,privateFee,board].map(value=>SyncAddress.fromStringUnsafe(value.toString()));
        if(new Set(addresses.map(value=>value.toString())).size!==3)throw new Error('Invalid Board state targets');
        const scopes=[addresses[0]];
        return this.operationQueue.runSynced(async ctx=>{
            const targets=await allToCompletion(addresses.map((address,index)=>this.#registeredSyncTarget(address,['SchnorrInitializerlessAccount','PrivateFPC','RollingBoard'][index],index===1?'pay_fee':undefined)));
            const artifact=targets[2].artifact;
            const matches=artifact&&syncFunctionAbis(artifact).filter(fn=>fn.name===method);
            if(matches?.length!==1 || !(method==='get_deposit_ids'?matches[0].functionType==='utility':['private','public'].includes(matches[0].functionType)))throw new Error('Invalid Board state ABI');
            const fn=matches[0];
            if(method==='get_deposit_ids') {
                // Account readiness needs only these two contracts. Discover
                // their notes together in the native changeset; subsequent
                // unchanged utilities consume the normal anchor-scoped cache.
                targets[2].selector=await SyncSelector.fromNameAndParameters(fn.name,fn.parameters);
                await this.#syncOrdinaryPostTargets(collateralOnly?[targets[2]]:targets.slice(1),this.#getSimulatorForTx(),ctx,scopes);
                return;
            }
            const accountAbi=new SyncAccountEntrypoint(targets[0].address,undefined).getEntrypointAbi();
            targets[0].selector=await SyncSelector.fromNameAndParameters(accountAbi.name,accountAbi.parameters);
            targets[2].selector=await SyncSelector.fromNameAndParameters(fn.name,fn.parameters);
            const oracle=new PrivateKernelOracle(this.contractStore,this.contractClassService,this.keyStore,this.node,ctx.anchorBlockHeader);
            // A public Board call has no private Board kernel frame. Its state
            // is still needed by the action's preparation utilities.
            const privateTargets=fn.functionType==='private'?targets:targets.slice(0,2);
            await allToCompletion([
                this.#syncOrdinaryPostTargets(targets,this.#getSimulatorForTx(),ctx,scopes),
                allToCompletion(privateTargets.map(target=>oracle.getUpdatedClassIdHints(target.address))),
            ]);
        });
    }
    // Public API\n`);
 source=replace(source,'return this.#proveTx(ctx, txRequest, privateExecutionResult);','return this.#proveTx(ctx, txRequest, privateExecutionResult, validatePublic);');
 source=replace(source,'   */ sync() {\n        return this.operationQueue.run(()=>this.blockStateSynchronizer.sync());',`   */ sync({snapshotAncestry=false} = {}) {
        if(typeof snapshotAncestry!=='boolean')throw new Error('Invalid sync snapshot option');
        // The same captured source plan and archive-membership verifier used by
        // account reads establish an exact native anchor for action preparation.
        // Admission, public execution, proving and inclusion remain unchanged.
        return this.operationQueue.run(()=>snapshotAncestry
            ? this.blockStateSynchronizer.syncWithAnchorRead(()=>undefined,{snapshotAncestry:true}).then(()=>undefined)
            : this.blockStateSynchronizer.sync());
    }
    // A public read at the captured source-plan anchor overlaps native checks.
    // It cannot become visible until the complete native sync succeeds.
    syncWithAnchorRead(read) {
        return this.operationQueue.run(()=>this.blockStateSynchronizer.syncWithAnchorRead(read));`);
 // Explicit optional metadata only; no private note contents, promises or
 // authoritative decisions cross this existing utility-result boundary.
 source=replace(source,'const { result, offchainEffects } = await contractFunctionSimulator.runUtility(', 'const { result, offchainEffects, noteHashWitnessHints } = await contractFunctionSimulator.runUtility(');
 source=replace(source,'                result,\n                offchainEffects\n', '                result,\n                offchainEffects,\n                ...(noteHashWitnessHints ? {noteHashWitnessHints} : {})\n');
 source=replace(source,'const { result: executionResult, offchainEffects } = await this.#executeUtility(', 'const { result: executionResult, offchainEffects, noteHashWitnessHints } = await this.#executeUtility(');
 source=replace(source,'                result: executionResult,\n                offchainEffects,', '                result: executionResult,\n                offchainEffects,\n                ...(noteHashWitnessHints ? {noteHashWitnessHints} : {}),');
 source=instrumentPxePhases(source);
 return source;
}
export function validatedKernelProve(source){
 if(sha(source)!=='97adb6e5c1b396b4edaa170ce9c2da6f9d5ff96c71c2014da70b8361da6cfad2')throw Error('Kernel validated proof source mismatch');
 source="import {PrivateKernelTailCircuitPublicInputs} from '@aztec-labs/stdlib/kernel';\n"+source;
 source=replace(source,'{ simulate, skipFeeEnforcement, profileMode } = {','{ simulate, skipFeeEnforcement, profileMode, beforeProof } = {');
 source=replace(source,'        const skipProofGeneration = this.fakeProofs || simulate;',`        if (beforeProof !== undefined && typeof beforeProof !== 'function') throw new Error('Invalid pre-proof validation hook');
        const skipProofGeneration = this.fakeProofs || simulate;`);
 source=replace(source,'        let chonkProof;',`        // Validation receives a detached SDK value. It cannot rewrite the
        // authoritative kernel output or witnesses subsequently proved.
        if (beforeProof) await beforeProof(PrivateKernelTailCircuitPublicInputs.fromBuffer(tailOutput.publicInputs.toBuffer()));
        let chonkProof;`);
 // Settled native read requests already contain the canonical tree values.
 // Begin independent membership reads before init; pending/transient reads are
 // deliberately excluded. The unchanged reset builder still checks every hint.
 source=replace(source,'        const generateWitnesses = !skipProofGeneration || profileMode !== \'none\';',`        const settledReads = skipProofGeneration ? Promise.resolve([]) : this.prefetchSettledReadRequests(executionResult);
        try {
        const generateWitnesses = !skipProofGeneration || profileMode !== 'none';`);
 source=replace(source,'        // Validation receives a detached SDK value.',`        const settledResults = await settledReads;
        const settledFailure = settledResults.find(result => result.status === 'rejected');
        if (settledFailure) throw settledFailure.reason;
        // Validation receives a detached SDK value.`);
 source=replace(source,`        };
    }
    /**
   * Checks that the public inputs`, `        };
        } finally {
            // Preserve an earlier native failure while draining all started I/O.
            await settledReads;
        }
    }
    /**
   * Checks that the public inputs`);
 source=replace(source,'    /** Prefetches updated class id hints',`    prefetchSettledReadRequests(executionResult) {
        const reads = [];
        for (const [field, method] of [['noteHashReadRequests','getNoteHashMembershipWitness'], ['nullifierReadRequests','getNullifierMembershipWitness']]) {
            const values = collectNested([executionResult.entrypoint], execution => execution.publicInputs[field].getActiveItems())
                .filter(request => request.contractAddress.isZero())
                .map(request => Fr.fromString(request.value.toString()));
            for (const value of uniqueBy(values, value => value.toString())) {
                reads.push(() => this.oracle[method](value));
            }
        }
        return Promise.allSettled(reads.map(read => Promise.resolve().then(read)));
    }
    /** Prefetches updated class id hints`);
 source=instrumentKernelPhases(source);
 return source;
}

function timingHelpers(){return `const beginRollingProofSpan=${beginProofSpan.toString()};
async function measureRollingProofPhase(stage,operation){const finish=beginRollingProofSpan('native.phase.'+stage);try{return await operation();}finally{finish();}}
`;}
function instrumentPxePhases(source){
 source=timingHelpers()+source;
 const proveStart=source.indexOf('*/ proveTx(txRequest, { scopes'),proveEnd=source.indexOf('\n    /**',proveStart);
 if(proveStart<0||proveEnd<0)throw Error('Missing native proof phase boundary');
 let prove=source.slice(proveStart,proveEnd);
 prove=replace(prove,'        let privateExecutionResult;',"        let privateExecutionResult;\n        const finishQueue=beginRollingProofSpan('native.phase.queue-and-anchor');");
 prove=replace(prove,'            const contractFunctionSimulator = this.#getSimulatorForTx();','            finishQueue();\n            const contractFunctionSimulator = this.#getSimulatorForTx();');
 source=source.slice(0,proveStart)+prove+source.slice(proveEnd);
 source=replace(source,'if (preSyncCalls) await this.#syncOrdinaryPostCalls(txRequest, preSyncCalls, contractFunctionSimulator, ctx, scopes);',
  "if (preSyncCalls) await measureRollingProofPhase('contract-sync',()=>this.#syncOrdinaryPostCalls(txRequest, preSyncCalls, contractFunctionSimulator, ctx, scopes));");
 source=replace(source,`            privateExecutionResult = await this.#executePrivate({
                contractFunctionSimulator,
                txRequest,
                anchorBlockHeader: ctx.anchorBlockHeader,
                scopes,
                changeSetId: ctx.changeSetId,
                senderForTags
            });`, `            privateExecutionResult = await measureRollingProofPhase('private-execution',()=>this.#executePrivate({
                contractFunctionSimulator,
                txRequest,
                anchorBlockHeader: ctx.anchorBlockHeader,
                scopes,
                changeSetId: ctx.changeSetId,
                senderForTags
            }));`);
 source=replace(source,'        const txProvingResult = new TxProvingResult(',"        const finishResult=beginRollingProofSpan('native.phase.result-and-tag-persistence');\n        const txProvingResult = new TxProvingResult(");
 source=replace(source,'        return txProvingResult;','        finishResult();\n        return txProvingResult;');
 source=replace(source,'        const simulatedTx = await new PrivateSimulationResult(privateExecutionResult, publicInputs).toSimulatedTx();\n        // Both checks',"        const simulatedTx = await measureRollingProofPhase('validation-transaction',()=>new PrivateSimulationResult(privateExecutionResult, publicInputs).toSimulatedTx());\n        // Both checks");
 source=replace(source,'() => publicInputs.forPublic ? this.#simulatePublicCalls(simulatedTx, false) : undefined,',"() => publicInputs.forPublic ? measureRollingProofPhase('public-execution',()=>this.#simulatePublicCalls(simulatedTx, false)) : undefined,");
 source=replace(source,'() => this.node.isValidTx(simulatedTx, {isSimulation: true, skipFeeEnforcement: false}),',"() => measureRollingProofPhase('admission-check',()=>this.node.isValidTx(simulatedTx, {isSimulation: true, skipFeeEnforcement: false})),");
 source=replace(source,"        const abi=new SyncAccountEntrypoint","        const finishBinding=beginRollingProofSpan('native.phase.sync-binding');\n        const abi=new SyncAccountEntrypoint");
 source=replace(source,'        await this.#syncOrdinaryPostTargets(targets,simulator,ctx,scopes);',"        finishBinding();\n        await this.#syncOrdinaryPostTargets(targets,simulator,ctx,scopes);");
 // Binding is small; class resolution and discovery are independently awaited groups.
 source=replace(source,'        await allToCompletion(targets.map(async target=>check((await this.contractClassService.getCurrentClassId(target.address,ctx.anchorBlockHeader))?.toString()===target.classId)));',"        await measureRollingProofPhase('sync-classes',()=>allToCompletion(targets.map(async target=>check((await this.contractClassService.getCurrentClassId(target.address,ctx.anchorBlockHeader))?.toString()===target.classId))));");
 source=replace(source,'        await allToCompletion(targets.map(target=>this.contractSyncService.ensureContractSynced({',"        await measureRollingProofPhase('sync-records',()=>allToCompletion(targets.map(target=>this.contractSyncService.ensureContractSynced({");
 source=replace(source,'anchorBlockHeader:ctx.anchorBlockHeader,changeSetId:ctx.changeSetId,scopes,triggeredBy:undefined,\n        })));','anchorBlockHeader:ctx.anchorBlockHeader,changeSetId:ctx.changeSetId,scopes,triggeredBy:undefined,\n        }))));');
 return source;
}
function instrumentKernelPhases(source){
 source=timingHelpers()+source;
 source=replace(source,'        const updatedClassIdHintsMap = await this.prefetchUpdatedClassIdHints(executionResult);',"        const updatedClassIdHintsMap = await measureRollingProofPhase('kernel-class-hints',()=>this.prefetchUpdatedClassIdHints(executionResult));\n        const finishKernelBody=beginRollingProofSpan('native.phase.kernel-body');");
 source=replace(source,'        // Validation receives a detached SDK value.',"        finishKernelBody();\n        // Validation receives a detached SDK value.");
 source=replace(source,'if (beforeProof) await beforeProof(PrivateKernelTailCircuitPublicInputs.fromBuffer(tailOutput.publicInputs.toBuffer()));',"if (beforeProof) await measureRollingProofPhase('validation',()=>beforeProof(PrivateKernelTailCircuitPublicInputs.fromBuffer(tailOutput.publicInputs.toBuffer())));");
 source=replace(source,'const proofWithPublicInputs = await this.proofCreator.createChonkProof(executionSteps);',"const proofWithPublicInputs = await measureRollingProofPhase('remote-proof',()=>this.proofCreator.createChonkProof(executionSteps));");
 source=replace(source,'            this.ensurePublicInputsMatch(proofWithPublicInputs, tailOutput.publicInputs);',"            const finishPublicInputs=beginRollingProofSpan('native.phase.proof-public-inputs');\n            this.ensurePublicInputsMatch(proofWithPublicInputs, tailOutput.publicInputs);");
 source=replace(source,'            chonkProof = proofWithPublicInputs.removePublicInputs();','            chonkProof = proofWithPublicInputs.removePublicInputs();\n            finishPublicInputs();');
 return source;
}
