import { BlockNumber } from '@aztec-labs/foundation/branded-types';
import { Point } from '@aztec-labs/foundation/curves/grumpkin';
import { createLogger } from '@aztec-labs/foundation/log';
import { allToCompletion } from '@aztec-labs/foundation/promise';
import { Timer } from '@aztec-labs/foundation/timer';
import { protocolContractNames } from '@aztec-labs/protocol-contracts';
import { FunctionType, decodeFunctionSignature } from '@aztec-labs/stdlib/abi';
import { GENESIS_BLOCK_HEADER_HASH } from '@aztec-labs/stdlib/block';
import { computeContractAddressFromInstance } from '@aztec-labs/stdlib/contract';
import { SimulationError } from '@aztec-labs/stdlib/errors';
import { computeAddressSecret } from '@aztec-labs/stdlib/keys';
import { deriveEcdhSharedSecretPoint, protectFromForgery } from '@aztec-labs/stdlib/logs';
import { PrivateSimulationResult, TxProfileResult, TxProvingResult, TxSimulationResult } from '@aztec-labs/stdlib/tx';
import { inspect } from 'util';
import { BlockSynchronizer } from './block_synchronizer/index.js';
import { ContractClassService } from './contract/contract_class_service.js';
import { ContractSyncService } from './contract/contract_sync_service.js';
import { ContractFunctionSimulator, generateSimulatedProvingResult } from './contract_function_simulator/contract_function_simulator.js';
import { displayDebugLogs } from './contract_logging.js';
import { PXEDebugUtils } from './debug/pxe_debug_utils.js';
import { enrichPublicSimulationError, enrichSimulationError } from './error_enriching.js';
import { PrivateEventFilterValidator } from './events/private_event_filter_validator.js';
import { TxResolverService } from './messages/tx_resolver_service.js';
import { withCache } from './node/caching_aztec_node.js';
import { OperationQueue } from './operation_queue.js';
import { PrivateKernelExecutionProver } from './private_kernel/private_kernel_execution_prover.js';
import { PrivateKernelOracle } from './private_kernel/private_kernel_oracle.js';
import { openPxeStores } from './storage/open_pxe_stores.js';
import { StagedWriteCoordinator } from './storage/staged_write_coordinator.js';
import { persistSenderTaggingIndexRangesForTx } from './tagging/index.js';
/**
 * Private eXecution Environment (PXE) is a library used by wallets to simulate private phase of transactions and to
 * manage private state of users.
 */ export class PXE {
    node;
    nodeDebug;
    db;
    blockStateSynchronizer;
    keyStore;
    contractStore;
    noteStore;
    capsuleStore;
    factStore;
    anchorBlockStore;
    senderTaggingStore;
    taggingSecretSourcesStore;
    recipientTaggingStore;
    addressStore;
    privateEventStore;
    contractSyncService;
    contractClassService;
    txResolver;
    l2TipsStore;
    simulator;
    proverEnabled;
    proofCreator;
    protocolContractsProvider;
    preloadedContractsProvider;
    log;
    operationQueue;
    debug;
    hooks;
    constructor(node, nodeDebug, db, blockStateSynchronizer, keyStore, contractStore, noteStore, capsuleStore, factStore, anchorBlockStore, senderTaggingStore, taggingSecretSourcesStore, recipientTaggingStore, addressStore, privateEventStore, contractSyncService, contractClassService, txResolver, l2TipsStore, simulator, proverEnabled, proofCreator, protocolContractsProvider, preloadedContractsProvider, log, operationQueue, debug, hooks){
        this.node = node;
        this.nodeDebug = nodeDebug;
        this.db = db;
        this.blockStateSynchronizer = blockStateSynchronizer;
        this.keyStore = keyStore;
        this.contractStore = contractStore;
        this.noteStore = noteStore;
        this.capsuleStore = capsuleStore;
        this.factStore = factStore;
        this.anchorBlockStore = anchorBlockStore;
        this.senderTaggingStore = senderTaggingStore;
        this.taggingSecretSourcesStore = taggingSecretSourcesStore;
        this.recipientTaggingStore = recipientTaggingStore;
        this.addressStore = addressStore;
        this.privateEventStore = privateEventStore;
        this.contractSyncService = contractSyncService;
        this.contractClassService = contractClassService;
        this.txResolver = txResolver;
        this.l2TipsStore = l2TipsStore;
        this.simulator = simulator;
        this.proverEnabled = proverEnabled;
        this.proofCreator = proofCreator;
        this.protocolContractsProvider = protocolContractsProvider;
        this.preloadedContractsProvider = preloadedContractsProvider;
        this.log = log;
        this.operationQueue = operationQueue;
        this.debug = debug;
        this.hooks = hooks;
    }
    /**
   * Creates an instance of a PXE by instantiating all the necessary data providers and services.
   * Also triggers the registration of the protocol contracts and makes sure the provided node
   * can be contacted.
   *
   * @returns A promise that resolves PXE is ready to be used.
   */ static async create({ node, nodeDebug, store, proofCreator, simulator, protocolContractsProvider, preloadedContractsProvider, config, loggerOrSuffix, hooks }) {
        // Extract bindings from the logger, or use empty bindings if a string suffix is provided.
        const bindings = loggerOrSuffix && typeof loggerOrSuffix !== 'string' ? loggerOrSuffix.getBindings() : undefined;
        const log = !loggerOrSuffix || typeof loggerOrSuffix === 'string' ? createLogger(loggerOrSuffix ? `pxe:service:${loggerOrSuffix}` : `pxe:service`) : loggerOrSuffix;
        const info = await node.getNodeInfo();
        // Source the genesis block hash from the node so PXE's L2BlockStream agrees with the node's
        // archiver on the dynamic initial header hash. Without this the tip store would fall back to
        // the static `GENESIS_BLOCK_HEADER_HASH` constant, which only matches deployments with the
        // default empty genesis (timestamp 0, no prefilled public data) and diverges otherwise — the
        // sync at block 0 would then get stuck in `areBlockHashesEqualAt` and abort. If the node does
        // not return a genesis block (older node or test fixture) we fall back to the static constant.
        const initialBlockHash = (await node.getBlock(BlockNumber.ZERO))?.hash ?? GENESIS_BLOCK_HEADER_HASH;
        const proverEnabled = config.proverEnabled !== undefined ? config.proverEnabled : info.realProofs;
        const { addressStore, privateEventStore, contractStore, noteStore, anchorBlockStore, senderTaggingStore, taggingSecretSourcesStore, recipientTaggingStore, capsuleStore, keyStore, l2TipsStore, factStore } = openPxeStores(store, initialBlockHash);
        // Every PXE consumer reads through this one wrapper, so a read cached by one is served to the rest. Only
        // immutable, hash-pinned reads are cached (the rule lives on `withCache`), which makes it safe regardless of
        // the consumer's anchor block; the block synchronizer wipes it on anchor updates to bound memory.
        const readCachedNode = withCache(node);
        const contractClassService = new ContractClassService(readCachedNode, contractStore);
        const contractSyncService = new ContractSyncService(readCachedNode, contractStore, contractClassService, noteStore, createLogger('pxe:contract_sync', bindings), config);
        const txResolver = new TxResolverService(readCachedNode);
        const stagedStores = [
            capsuleStore,
            senderTaggingStore,
            recipientTaggingStore,
            privateEventStore,
            noteStore,
            factStore
        ];
        const synchronizer = new BlockSynchronizer(readCachedNode, store, anchorBlockStore, stagedStores, l2TipsStore, contractSyncService, config, bindings);
        const stagedWriteCoordinator = new StagedWriteCoordinator({
            kvStore: store,
            stagedStores,
            bindings
        });
        const debugUtils = new PXEDebugUtils(contractSyncService, noteStore);
        const operationQueue = new OperationQueue({
            node: readCachedNode,
            synchronizer,
            anchorBlockStore,
            stagedWriteCoordinator,
            contributors: [
                contractSyncService
            ],
            autoSync: config.autoSync,
            log
        });
        const pxe = new PXE(readCachedNode, nodeDebug, store, synchronizer, keyStore, contractStore, noteStore, capsuleStore, factStore, anchorBlockStore, senderTaggingStore, taggingSecretSourcesStore, recipientTaggingStore, addressStore, privateEventStore, contractSyncService, contractClassService, txResolver, l2TipsStore, simulator, proverEnabled, proofCreator, protocolContractsProvider, preloadedContractsProvider, log, operationQueue, debugUtils, hooks);
        debugUtils.setPXEHelpers((fn)=>operationQueue.runSynced(fn, {
                forceSync: true
            }), pxe.#getSimulatorForTx.bind(pxe), pxe.#executeUtility.bind(pxe));
        operationQueue.start();
        await allToCompletion([
            pxe.#registerProtocolContracts(),
            pxe.#registerPreloadedContracts()
        ]);
        log.info(`Started PXE connected to chain ${info.l1ChainId} version ${info.rollupVersion}`);
        return pxe;
    }
    // Internal methods
    #getSimulatorForTx(overrides) {
        return new ContractFunctionSimulator({
            contractStore: this.contractStore,
            contractClassService: this.contractClassService,
            overrides: overrides?.contracts,
            noteStore: this.noteStore,
            keyStore: this.keyStore,
            addressStore: this.addressStore,
            aztecNode: this.node,
            l2TipsStore: this.l2TipsStore,
            senderTaggingStore: this.senderTaggingStore,
            recipientTaggingStore: this.recipientTaggingStore,
            taggingSecretSourcesStore: this.taggingSecretSourcesStore,
            capsuleStore: this.capsuleStore,
            factStore: this.factStore,
            privateEventStore: this.privateEventStore,
            simulator: this.simulator,
            contractSyncService: this.contractSyncService,
            txResolver: this.txResolver,
            hooks: this.hooks
        });
    }
    /** Best-effort debug function name for the class `address` runs at `anchorBlockHeader`. Used for log display only. */ async #getDebugFunctionName(address, selector, anchorBlockHeader) {
        try {
            const classId = await this.contractClassService.getCurrentClassId(address, anchorBlockHeader);
            return classId ? await this.contractStore.getDebugFunctionName(classId, selector) : `${address}:${selector}`;
        } catch  {
            return `${address}:${selector}`;
        }
    }
    /** Best-effort debug contract name for the class `address` runs at `anchorBlockHeader`. Used for log display only. */ async #getDebugContractName(address, anchorBlockHeader) {
        try {
            const classId = await this.contractClassService.getCurrentClassId(address, anchorBlockHeader);
            return classId ? await this.contractStore.getDebugContractName(classId) : undefined;
        } catch  {
            return undefined;
        }
    }
    async #registerProtocolContracts() {
        const registered = Object.fromEntries(await allToCompletion(protocolContractNames.map(async (name)=>{
            const { address, instance, artifact } = await this.protocolContractsProvider.getProtocolContractArtifact(name);
            await this.contractStore.addContractArtifact(artifact);
            await this.contractStore.addContractInstance(instance);
            return [
                name,
                address.toString()
            ];
        })));
        this.log.verbose(`Registered protocol contracts in pxe`, registered);
    }
    async #registerPreloadedContracts() {
        const contracts = await this.preloadedContractsProvider.getPreloadedContracts();
        await allToCompletion(contracts.map(async ({ instance, artifact })=>{
            if (artifact) {
                await this.registerContractClass(artifact);
            }
            await this.registerContract(instance);
        }));
        this.log.verbose(`Registered preloaded contracts in pxe`, {
            contracts: contracts.map(({ instance })=>instance.address.toString())
        });
    }
    // Executes the entrypoint private function, as well as all nested private
    // functions that might arise.
    async #executePrivate({ contractFunctionSimulator, txRequest, anchorBlockHeader, scopes, changeSetId, senderForTags }) {
        const { origin: contractAddress, functionSelector } = txRequest;
        try {
            await this.contractSyncService.ensureContractSynced({
                contract: contractAddress,
                functionToInvokeAfterSync: functionSelector,
                utilityExecutor: (privateSyncCall, execScopes)=>this.#executeUtility(contractFunctionSimulator, privateSyncCall, [], execScopes, anchorBlockHeader, changeSetId),
                anchorBlockHeader,
                changeSetId,
                scopes,
                triggeredBy: undefined
            });
            const result = await contractFunctionSimulator.run(txRequest, {
                anchorBlockHeader,
                scopes,
                changeSetId,
                senderForTags
            });
            this.log.debug(`Private simulation completed for ${contractAddress.toString()}:${functionSelector}`);
            return result;
        } catch (err) {
            if (err instanceof SimulationError) {
                await enrichSimulationError(err, this.contractStore, this.contractClassService, anchorBlockHeader, this.log);
            }
            throw err;
        }
    }
    /**
   * Execute a utility function call on the given contract.
   * @param contractFunctionSimulator - The simulator to use for the function call.
   * @param call - The function call to execute.
   * @param authWitnesses - Authentication witnesses required for the function call.
   * @param scopes - Optional array of account addresses whose notes can be accessed in this call. Defaults to all
   * accounts if not specified.
   * @param anchorBlockHeader - The anchor block header established by the enclosing operation.
   * @param changeSetId - The change set ID for staged writes.
   * @returns The execution result containing the outputs of the utility function.
   */ async #executeUtility(contractFunctionSimulator, call, authWitnesses, scopes, anchorBlockHeader, changeSetId) {
        try {
            const { result, offchainEffects } = await contractFunctionSimulator.runUtility(call, authWitnesses ?? [], anchorBlockHeader, scopes, changeSetId);
            return {
                result,
                offchainEffects
            };
        } catch (err) {
            if (err instanceof SimulationError) {
                await enrichSimulationError(err, this.contractStore, this.contractClassService, anchorBlockHeader, this.log);
            }
            throw err;
        }
    }
    /**
   * Simulate the public part of a transaction.
   * This allows to catch public execution errors before submitting the transaction.
   * It can also be used for estimating gas in the future.
   * @param tx - The transaction to be simulated.
   */ async #simulatePublicCalls(tx, skipFeeEnforcement, overrides) {
        // Simulating public calls can throw if the TX fails in a phase that doesn't allow reverts (setup)
        // Or return as reverted if it fails in a phase that allows reverts (app logic, teardown)
        try {
            const result = await this.node.simulatePublicCalls(tx, skipFeeEnforcement, overrides);
            if (result.revertReason) {
                throw result.revertReason;
            }
            return result;
        } catch (err) {
            if (err instanceof SimulationError) {
                try {
                    const anchorBlockHeader = await this.anchorBlockStore.getBlockHeader();
                    await enrichPublicSimulationError(err, this.contractStore, this.contractClassService, anchorBlockHeader, this.log);
                } catch (enrichErr) {
                    this.log.error(`Failed to enrich public simulation error: ${enrichErr}`);
                }
            }
            throw err;
        }
    }
    /**
   * Generate a kernel proof, and create a private kernel output.
   * The function takes in a transaction execution request, and the result of private execution
   * and then generates a kernel proof.
   *
   * @param txExecutionRequest - The transaction request to be simulated and proved.
   * @param proofCreator - The proof creator to use for proving the execution.
   * @param privateExecutionResult - The result of the private execution
   * @param config - The configuration for the kernel execution prover.
   * @returns An object that contains the output of the kernel execution, including the ChonkProof if proving is enabled.
   */ async #prove(txExecutionRequest, proofCreator, privateExecutionResult, anchorBlockHeader, config) {
        const kernelOracle = new PrivateKernelOracle(this.contractStore, this.contractClassService, this.keyStore, this.node, anchorBlockHeader);
        const kernelTraceProver = new PrivateKernelExecutionProver(kernelOracle, proofCreator, !this.proverEnabled, this.log.getBindings());
        this.log.debug(`Executing kernel trace prover (${JSON.stringify(config)})...`);
        return await kernelTraceProver.proveWithKernels(txExecutionRequest.toTxRequest(), privateExecutionResult, config);
    }
    // Public API
    /**
   * Triggers a sync of PXE state with the node, regardless of the `autoSync` config flag. Use this to
   * batch syncs across composite flows when `autoSync` is disabled (e.g. one sync per simulate+send
   * instead of one per inner PXE call). Serialized through the queue.
   */ sync() {
        return this.operationQueue.run(()=>this.blockStateSynchronizer.sync());
    }
    /**
   * Returns the block header up to which the PXE has synced.
   * @returns The synced block header
   */ getSyncedBlockHeader() {
        return this.operationQueue.run(()=>{
            return this.anchorBlockStore.getBlockHeader();
        });
    }
    /**
   * Returns the address preimage of the contract instance at a given address, if it's registered in the PXE.
   * @param address - The contract address.
   * @returns The contract instance address preimage if found, undefined otherwise.
   */ getContractInstance(address) {
        return this.contractStore.getContractInstance(address);
    }
    /**
   * Returns the contract artifact for a given contract class id, if it's registered in the PXE.
   * @param id - Identifier of the contract class.
   * @returns The contract artifact if found, undefined otherwise.
   */ async getContractArtifact(id) {
        return await this.contractStore.getContractArtifact(id);
    }
    /**
   * Registers a user account in PXE.
   *
   * PXE holds the account's four privacy secret keys but only the *public* message-signing and fallback keys: their
   * secret keys are withheld, since PXE is not trusted to hold them.
   *
   * Does nothing if the account is already registered.
   *
   * The four privacy secret keys can be retrieved later with {@link getAccountSecretKeys}.
   *
   * @param keys - The account's privacy keys: four secret keys plus the message-signing and fallback public keys.
   * @param partialAddress - The partial address of the account contract corresponding to the account being registered.
   * @returns The complete address of the account.
   */ async registerAccount(keys, partialAddress) {
        const accounts = await this.keyStore.getAccounts();
        const accountCompleteAddress = await this.keyStore.addAccount(keys, partialAddress);
        if (accounts.some((a)=>a.equals(accountCompleteAddress.address))) {
            this.log.info(`Account:\n "${accountCompleteAddress.address.toString()}"\n already registered.`);
            return accountCompleteAddress;
        } else {
            this.log.info(`Registered account ${accountCompleteAddress.address.toString()}`);
            this.log.debug(`Registered account\n ${accountCompleteAddress.toReadableString()}`);
        }
        await this.addressStore.addCompleteAddress(accountCompleteAddress);
        return accountCompleteAddress;
    }
    /**
   * Retrieves the four privacy secret keys PXE holds for a registered account (nullifier-hiding, incoming-viewing,
   * outgoing-viewing, tagging).
   *
   * These do NOT grant control over an account's assets, e.g. they are insufficient to impersonate the account or to
   * spend notes, but they _do_ guard the account's privacy. Parties that have knowledge of these keys can decrypt all
   * messages sent to the account, discover all of their on-chain activity, including notes, events, etc.
   *
   * Security is paramount when handling these keys, which should itself be a very rare occurrence. Other than exporting
   * and then importing an account into a separate PXE/wallet, there is typically no need for a wallet to ever access
   * these keys. Applications should NEVER be given access to them.
   *
   * @throws If the account is not registered.
   */ getAccountSecretKeys(account) {
        return this.keyStore.getAccountSecretKeys(account);
    }
    /**
   * Registers a source from which this PXE derives the tagging secrets it scans for to discover incoming private logs.
   * See {@link TaggingSecretSource} for the meaning of each variant. Does nothing if the source is already registered.
   *
   * After a new source is added we clear the cache tracking which contracts have finished syncing, so every contract
   * re-syncs against the new source's logs (whose notes/events could belong to any contract). Already-discovered
   * notes/events are not discarded.
   */ async registerTaggingSecretSource(source) {
        let wasAdded;
        switch(source.kind){
            case 'address-derived':
                wasAdded = await this.#registerSender(source.sender);
                break;
            case 'arbitrary-secret':
                wasAdded = await this.#registerSharedSecret(source.recipient, 'arbitrary-secret', source.secret);
                break;
            case 'handshake':
                wasAdded = await this.#registerSharedSecret(source.recipient, 'handshake', await this.#deriveHandshakeSecret(source.recipient, source.ephPk));
                break;
            default:
                {
                    const _ = source;
                    throw new Error('Unhandled tagging secret source kind');
                }
        }
        if (wasAdded) {
            // Queued to avoid wiping while an operation is in flight.
            await this.operationQueue.run(()=>Promise.resolve(this.contractSyncService.wipe()));
        }
    }
    /**
   * Removes a previously registered tagging secret source, identified by its registered form (see
   * {@link getTaggingSecretSources}). Does nothing if it was not registered.
   */ async removeTaggingSecretSource(source) {
        switch(source.kind){
            case 'address-derived':
                {
                    const { sender } = source;
                    const wasRemoved = await this.taggingSecretSourcesStore.removeSender(sender);
                    this.log.info(wasRemoved ? `Removed sender:\n ${sender.toString()}` : `Sender:\n "${sender.toString()}"\n not registered in PXE.`);
                    break;
                }
            case 'arbitrary-secret':
            case 'handshake':
                {
                    const { kind, recipient, secret } = source;
                    const wasRemoved = await this.taggingSecretSourcesStore.removeSharedSecret(recipient, kind, secret);
                    this.log.info(wasRemoved ? `Removed ${kind} shared secret for recipient:\n ${recipient.toString()}` : `No ${kind} shared secret registered for recipient:\n ${recipient.toString()}`);
                    break;
                }
            default:
                {
                    const _ = source;
                    throw new Error('Unhandled tagging secret source kind');
                }
        }
    }
    async getTaggingSecretSources(filter) {
        const [senders, secrets] = await allToCompletion([
            this.taggingSecretSourcesStore.getSenders(),
            this.taggingSecretSourcesStore.getAllSharedSecrets()
        ]);
        const sources = [
            ...senders.map((sender)=>({
                    kind: 'address-derived',
                    sender
                })),
            ...secrets.map(({ recipient, kind, secret })=>({
                    kind,
                    recipient,
                    secret
                }))
        ];
        return filter?.kind ? sources.filter((source)=>source.kind === filter.kind) : sources;
    }
    /** Registers a sender, skipping addresses that belong to a local account. Returns whether it was newly added. */ async #registerSender(address) {
        if (!await address.isValid()) {
            throw new Error(`Address ${address} is not valid: it does not correspond to a point on the Grumpkin curve. Cannot register it as a sender.`);
        }
        const accounts = await this.keyStore.getAccounts();
        if (accounts.some((a)=>a.equals(address))) {
            this.log.info(`Sender:\n "${address.toString()}"\n already registered.`);
            return false;
        }
        const wasAdded = await this.taggingSecretSourcesStore.addSender(address);
        this.log.info(wasAdded ? `Added sender:\n ${address.toString()}` : `Sender:\n "${address.toString()}"\n already registered.`);
        return wasAdded;
    }
    /**
   * Derives the shared secret of a handshake from its ephemeral public key: the raw ECDH secret
   * `S = addressSecret(recipient) * ephPk` with the forgery protection applied,
   * matching the protected secret the registry stores and the derivation the recipient-side scan uses for
   * handshakes discovered onchain. The ephemeral key is reconstructed from its x-coordinate with a positive y,
   * matching how the protocol generates it.
   *
   * @throws If `ephPk` is not the x-coordinate of a Grumpkin curve point, or if `recipient` is not an account of
   * this PXE, since the derivation needs its keys.
   */ async #deriveHandshakeSecret(recipient, ephPk) {
        let ephPkPoint;
        try {
            ephPkPoint = await Point.fromXAndSign(ephPk, true);
        } catch  {
            throw new Error(`Ephemeral public key x-coordinate ${ephPk} does not correspond to a Grumpkin curve point.`);
        }
        const completeAddress = await this.addressStore.getCompleteAddress(recipient);
        if (!completeAddress || !await this.keyStore.hasAccount(recipient)) {
            throw new Error(`Recipient ${recipient} is not an account of this PXE. A handshake's shared secret can only be derived for an account whose keys are held.`);
        }
        const ivskM = await this.keyStore.getMasterIncomingViewingSecretKey(recipient);
        const addressSecret = await computeAddressSecret(await completeAddress.getPreaddress(), ivskM);
        const rawSecret = await deriveEcdhSharedSecretPoint(addressSecret, ephPkPoint);
        return protectFromForgery(rawSecret, ephPkPoint, await recipient.toAddressPoint());
    }
    /** Registers a resolved shared secret scoped to a recipient. Returns whether it was newly added. */ async #registerSharedSecret(recipient, kind, secret) {
        if (!await recipient.isValid()) {
            throw new Error(`Recipient ${recipient} is not valid: it does not correspond to a point on the Grumpkin curve. Cannot register a shared secret for it.`);
        }
        if (secret.isZero() || !secret.isOnCurve()) {
            throw new Error(`Shared secret ${secret} is not a valid non-zero point on the Grumpkin curve.`);
        }
        const wasAdded = await this.taggingSecretSourcesStore.addSharedSecret(recipient, kind, secret);
        this.log.info(wasAdded ? `Added ${kind} shared secret for recipient:\n ${recipient.toString()}` : `${kind} shared secret already registered for recipient:\n ${recipient.toString()}`);
        return wasAdded;
    }
    /**
   * Retrieves the user accounts registered on this PXE.
   * @returns An array of the accounts registered on this PXE.
   */ async getRegisteredAccounts() {
        // Get complete addresses of both the recipients and the accounts
        const completeAddresses = await this.addressStore.getCompleteAddresses();
        // Filter out the addresses not corresponding to accounts
        const accounts = await this.keyStore.getAccounts();
        return completeAddresses.filter((completeAddress)=>accounts.find((address)=>address.equals(completeAddress.address)));
    }
    /**
   * Registers a contract class in the PXE without registering any associated contract instance with it.
   *
   * @param artifact - The build artifact for the contract class.
   */ async registerContractClass(artifact) {
        const contractClassId = await this.contractStore.addContractArtifact(artifact);
        // Publishing the artifact's public function signatures to the node is part of "registering a class", so that
        // node-side debugging works regardless of which entrypoint (registerContractClass or registerContract) was used.
        const publicFunctionSignatures = artifact.functions.filter((fn)=>fn.functionType === FunctionType.PUBLIC).map((fn)=>decodeFunctionSignature(fn.name, fn.parameters));
        if (publicFunctionSignatures.length > 0) {
            await this.nodeDebug?.registerContractFunctionSignatures(publicFunctionSignatures);
        }
        this.log.info(`Added contract class ${artifact.name} with id ${contractClassId}`);
    }
    /**
   * Registers a deployed contract instance so its private state can be synced and its functions simulated. The
   * artifact for the class the instance runs must be registered separately via {@link registerContractClass}, before
   * or after this call; registration performs no validation, so a missing or mismatched artifact only surfaces when
   * the contract is later simulated. This is automatically called by aztec.js when deploying a contract.
   *
   * @param instance - The address preimage of the contract instance to register. The address is derived from it.
   * @returns The address of the registered instance.
   */ registerContract(instance) {
        // Run inside the queue so we can't race a concurrent simulation while writing the instance to the store.
        return this.operationQueue.run(async ()=>{
            const address = await computeContractAddressFromInstance(instance);
            await this.contractStore.addContractInstance({
                ...instance,
                address
            });
            this.log.info(`Added contract at ${address}`, {
                address
            });
            return address;
        });
    }
    /**
   * Retrieves the addresses of contracts added to this PXE.
   * @returns An array of contracts addresses registered on this PXE.
   */ getContracts() {
        return this.contractStore.getContractsAddresses();
    }
    /**
   * Proves the private portion of a simulated transaction, ready to send to the network
   * (where validators prove the public portion).
   *
   * @param txRequest - An authenticated tx request ready for proving
   * @param scopes - Addresses whose private state and keys are accessible during private execution.
   * @returns A result containing the proof and public inputs of the tail circuit.
   * @throws If contract code not found, or public simulation reverts.
   * Also throws if simulatePublic is true and public simulation reverts.
   */ proveTx(txRequest, { scopes, senderForTags }) {
        let privateExecutionResult;
        // We disable proving concurrently mostly out of caution, since it accesses some of our stores. Proving is so
        // computationally demanding that it'd be rare for someone to try to do it concurrently regardless.
        return this.operationQueue.runSynced(async ({ changeSetId, syncTime, anchorBlockHeader, recording, totalMs })=>{
            const contractFunctionSimulator = this.#getSimulatorForTx();
            privateExecutionResult = await this.#executePrivate({
                contractFunctionSimulator,
                txRequest,
                anchorBlockHeader,
                scopes,
                changeSetId,
                senderForTags
            });
            const { publicInputs, chonkProof, executionSteps, timings: { proving } = {} } = await this.#prove(txRequest, this.proofCreator, privateExecutionResult, anchorBlockHeader, {
                simulate: false,
                skipFeeEnforcement: false,
                profileMode: 'none'
            });
            const totalTime = totalMs();
            const perFunction = executionSteps.map(({ functionName, timings: { witgen, oracles } })=>({
                    functionName,
                    time: witgen,
                    oracles
                }));
            const timings = {
                total: totalTime,
                sync: syncTime,
                proving,
                perFunction,
                unaccounted: totalTime - ((syncTime ?? 0) + (proving ?? 0) + perFunction.reduce((acc, { time })=>acc + time, 0))
            };
            this.log.debug(`Proving completed in ${totalTime}ms`, {
                timings
            });
            const txProvingResult = new TxProvingResult(privateExecutionResult, publicInputs, chonkProof, {
                timings,
                nodeRPCCalls: recording.stats()
            });
            // We keep track of which tagging indices we've used in this tx so that we don't repeat them in future txs
            // (which would link them) without having to rely on this tx being mined (and us seeing the indices being used
            // onchain).
            // Note that this must happen _after_ proving as it requires the proof's public inputs, from which the kernels
            // may have removed some logs due to note-nullifier squashing - this may lead to range of tagging indices we've
            // actually used to being reduced.
            await persistSenderTaggingIndexRangesForTx(this.senderTaggingStore, privateExecutionResult.entrypoint.taggingIndexRanges, publicInputs, ()=>txProvingResult.getTxHash(), changeSetId, this.log);
            return txProvingResult;
        }, {
            errorContext: ()=>[
                    inspect(txRequest),
                    inspect(privateExecutionResult)
                ]
        });
    }
    /**
   * Profiles a transaction, reporting gate counts (unless disabled) and returns an execution trace.
   * @param txRequest - An authenticated tx request ready for simulation.
   * @returns A trace of the program execution with gate counts.
   * @throws If the code for the functions executed in this transaction have not been made available via `addContracts`.
   */ profileTx(txRequest, { profileMode, skipProofGeneration = true, scopes, senderForTags }) {
        // We disable concurrent profiles for consistency with simulateTx.
        return this.operationQueue.runSynced(async ({ changeSetId, syncTime, anchorBlockHeader, recording, totalMs })=>{
            const txInfo = {
                origin: txRequest.origin,
                functionSelector: txRequest.functionSelector,
                simulatePublic: false,
                chainId: txRequest.txContext.chainId,
                version: txRequest.txContext.version,
                authWitnesses: txRequest.authWitnesses.map((w)=>w.requestHash)
            };
            this.log.info(`Profiling transaction execution request to ${txRequest.functionSelector} at ${txRequest.origin}`, txInfo);
            const contractFunctionSimulator = this.#getSimulatorForTx();
            const privateExecutionResult = await this.#executePrivate({
                contractFunctionSimulator,
                txRequest,
                anchorBlockHeader,
                scopes,
                changeSetId,
                senderForTags
            });
            const { executionSteps, timings: { proving } = {} } = await this.#prove(txRequest, this.proofCreator, privateExecutionResult, anchorBlockHeader, {
                simulate: skipProofGeneration,
                skipFeeEnforcement: false,
                profileMode
            });
            const totalTime = totalMs();
            const perFunction = executionSteps.map(({ functionName, timings: { witgen, oracles } })=>{
                return {
                    functionName,
                    time: witgen,
                    oracles
                };
            });
            // Gate computation is time is not relevant for profiling, so we subtract it from the total time.
            const gateCountComputationTime = executionSteps.reduce((acc, { timings })=>acc + (timings.gateCount ?? 0), 0) ?? 0;
            const total = totalTime - gateCountComputationTime;
            const timings = {
                total,
                sync: syncTime,
                proving,
                perFunction,
                unaccounted: total - ((syncTime ?? 0) + (proving ?? 0) + perFunction.reduce((acc, { time })=>acc + time, 0))
            };
            return new TxProfileResult(executionSteps, {
                timings,
                nodeRPCCalls: recording.stats()
            });
        }, {
            errorContext: ()=>[
                    inspect(txRequest),
                    `profileMode=${profileMode}`
                ]
        });
    }
    /**
   * Simulates a transaction based on the provided preauthenticated execution request.
   * This will run a local simulation of private execution (and optionally of public as well), run the
   * kernel circuits to ensure adherence to protocol rules (without generating a proof), and return the
   * simulation results .
   *
   *
   * Note that this is used with `ContractFunctionInteraction::simulateTx` to bypass certain checks.
   * In that case, the transaction returned is only potentially ready to be sent to the network for execution.
   *
   *
   * @param txRequest - An authenticated tx request ready for simulation.
   * @returns A simulated transaction result object that includes public and private return values.
   * @throws If the code for the functions executed in this transaction have not been made available via `addContracts`.
   * Also throws if simulatePublic is true and public simulation reverts.
   *
   * TODO(#7456) Prevent msgSender being defined here for the first call
   */ simulateTx(txRequest, { simulatePublic, skipTxValidation = false, skipFeeEnforcement = false, skipKernels = true, overrides, scopes, senderForTags }) {
        // We disable concurrent simulations since those might execute oracles which read and write to the PXE stores (e.g.
        // to the capsules), and we need to prevent concurrent runs from interfering with one another (e.g. attempting to
        // delete the same read value, or reading values that another simulation is currently modifying).
        return this.operationQueue.runSynced(async ({ changeSetId, syncTime, anchorBlockHeader, recording, totalMs })=>{
            const txInfo = {
                origin: txRequest.origin,
                functionSelector: txRequest.functionSelector,
                simulatePublic,
                chainId: txRequest.txContext.chainId,
                version: txRequest.txContext.version,
                authWitnesses: txRequest.authWitnesses.map((w)=>w.requestHash)
            };
            this.log.info(`Simulating transaction execution request to ${txRequest.functionSelector} at ${txRequest.origin}`, txInfo);
            if (overrides?.contracts && Object.keys(overrides.contracts).length > 0 && !skipKernels) {
                throw new Error('Simulating with overridden contracts is not compatible with kernel execution. Please set skipKernels to true when simulating with overridden contracts.');
            }
            const contractFunctionSimulator = this.#getSimulatorForTx(overrides);
            // Execution of private functions only; no proving, and no kernel logic.
            const privateExecutionResult = await this.#executePrivate({
                contractFunctionSimulator,
                txRequest,
                anchorBlockHeader,
                scopes,
                changeSetId,
                senderForTags
            });
            let publicInputs;
            let executionSteps = [];
            if (skipKernels) {
                ({ publicInputs, executionSteps } = await generateSimulatedProvingResult(privateExecutionResult, (addr, sel)=>this.#getDebugFunctionName(addr, sel, anchorBlockHeader), this.node));
            } else {
                // Kernel logic, plus proving of all private functions and kernels.
                ({ publicInputs, executionSteps } = await this.#prove(txRequest, this.proofCreator, privateExecutionResult, anchorBlockHeader, {
                    simulate: true,
                    skipFeeEnforcement,
                    profileMode: 'none'
                }));
            }
            const privateSimulationResult = new PrivateSimulationResult(privateExecutionResult, publicInputs);
            const simulatedTx = await privateSimulationResult.toSimulatedTx();
            let publicSimulationTime;
            let publicOutput;
            if (simulatePublic && publicInputs.forPublic) {
                const publicSimulationTimer = new Timer();
                publicOutput = await this.#simulatePublicCalls(simulatedTx, skipFeeEnforcement, overrides);
                publicSimulationTime = publicSimulationTimer.ms();
                if (publicOutput?.debugLogs?.length) {
                    await displayDebugLogs(publicOutput.debugLogs, (addr)=>this.#getDebugContractName(addr, anchorBlockHeader));
                }
            }
            let validationTime;
            if (!skipTxValidation) {
                const validationTimer = new Timer();
                const validationResult = await this.node.isValidTx(simulatedTx, {
                    isSimulation: true,
                    skipFeeEnforcement
                });
                validationTime = validationTimer.ms();
                if (validationResult.result === 'invalid') {
                    const reason = validationResult.reason.length > 0 ? ` Reason: ${validationResult.reason.join(', ')}` : '';
                    throw new Error(`The simulated transaction is unable to be added to state and is invalid.${reason}`);
                }
            }
            const txHash = simulatedTx.getTxHash();
            const totalTime = totalMs();
            const perFunction = executionSteps.map(({ functionName, timings: { witgen, oracles } })=>({
                    functionName,
                    time: witgen,
                    oracles
                }));
            const timings = {
                total: totalTime,
                sync: syncTime,
                publicSimulation: publicSimulationTime,
                validation: validationTime,
                perFunction,
                unaccounted: totalTime - (syncTime + (publicSimulationTime ?? 0) + (validationTime ?? 0) + perFunction.reduce((acc, { time })=>acc + time, 0))
            };
            this.log.info(`Simulation completed for ${txHash.toString()} in ${totalTime}ms`, {
                txHash,
                ...txInfo,
                ...publicOutput ? {
                    gasUsed: publicOutput.gasUsed,
                    revertCode: publicOutput.txEffect.revertCode.getCode(),
                    revertReason: publicOutput.revertReason
                } : {}
            });
            return TxSimulationResult.fromPrivateSimulationResultAndPublicOutput(privateSimulationResult, publicOutput, {
                timings,
                nodeRPCCalls: recording.stats()
            });
        }, {
            errorContext: ()=>[
                    inspect(txRequest),
                    `simulatePublic=${simulatePublic}`,
                    `skipTxValidation=${skipTxValidation}`,
                    `scopes=${scopes.map((s)=>s.toString()).join(', ')}`
                ]
        });
    }
    /**
   * Executes a contract utility function.
   * @param call - The function call containing the function details, arguments, and target contract address.
   */ executeUtility(call, { authwits, scopes } = {
        scopes: []
    }) {
        // We disable concurrent executions since those might execute oracles which read and write to the PXE stores (e.g.
        // to the capsules), and we need to prevent concurrent runs from interfering with one another (e.g. attempting to
        // delete the same read value, or reading values that another execution is currently modifying).
        return this.operationQueue.runSynced(async ({ changeSetId, syncTime, anchorBlockHeader, recording, totalMs })=>{
            const functionTimer = new Timer();
            const contractFunctionSimulator = this.#getSimulatorForTx();
            await this.contractSyncService.ensureContractSynced({
                contract: call.to,
                functionToInvokeAfterSync: call.selector,
                utilityExecutor: (privateSyncCall, execScopes)=>this.#executeUtility(contractFunctionSimulator, privateSyncCall, [], execScopes, anchorBlockHeader, changeSetId),
                anchorBlockHeader,
                changeSetId,
                scopes,
                triggeredBy: undefined
            });
            const { result: executionResult, offchainEffects } = await this.#executeUtility(contractFunctionSimulator, call, authwits ?? [], scopes, anchorBlockHeader, changeSetId);
            const functionTime = functionTimer.ms();
            const totalTime = totalMs();
            const perFunction = [
                {
                    functionName: call.name,
                    time: functionTime
                }
            ];
            const timings = {
                total: totalTime,
                sync: syncTime,
                perFunction,
                unaccounted: totalTime - (syncTime + perFunction.reduce((acc, { time })=>acc + time, 0))
            };
            return {
                result: executionResult,
                offchainEffects,
                anchorBlockTimestamp: anchorBlockHeader.globalVariables.timestamp,
                stats: {
                    timings,
                    nodeRPCCalls: recording.stats()
                }
            };
        }, {
            errorContext: ()=>{
                const { to, name, args } = call;
                const stringifiedArgs = args.map((arg)=>arg.toString()).join(', ');
                return [
                    `executeUtility ${to}:${name}(${stringifiedArgs})`,
                    `scopes=${scopes.map((s)=>s.toString()).join(', ')}`
                ];
            }
        });
    }
    /**
   * Returns the private events given search parameters.
   * @param eventSelector - Event selector to search for.
   * @param filter
   *  contractAddress - The address of the contract to get events from. Required.
   *  scopes - One or more event scope addresses to filter by. Required.
   *  fromBlock - The block number to search from (inclusive). Optional. If provided, it must be >= 0.
   *    Defaults to 0.
   *    If toBlock is defined but fromBlock is not, fromBlock defaults to toBlock - 1.
   *  toBlock - The block number to search up to (exclusive). Optional. If provided, it must be > 0.
   *    Defaults to the latest known block to PXE + 1.
   * @returns - The packed events with block and tx metadata.
   */ getPrivateEvents(eventSelector, filter) {
        return this.operationQueue.runSynced(async ({ changeSetId, anchorBlockHeader })=>{
            const contractFunctionSimulator = this.#getSimulatorForTx();
            await this.contractSyncService.ensureContractSynced({
                contract: filter.contractAddress,
                functionToInvokeAfterSync: null,
                utilityExecutor: async (privateSyncCall, execScopes)=>await this.#executeUtility(contractFunctionSimulator, privateSyncCall, [], execScopes, anchorBlockHeader, changeSetId),
                anchorBlockHeader,
                changeSetId,
                scopes: filter.scopes,
                triggeredBy: undefined
            });
            const sanitizedFilter = new PrivateEventFilterValidator(anchorBlockHeader.getBlockNumber()).validate(filter);
            this.log.debug(`Getting private events for ${sanitizedFilter.contractAddress.toString()} from ${sanitizedFilter.fromBlock} to ${sanitizedFilter.toBlock}`);
            return this.privateEventStore.getPrivateEvents(eventSelector, sanitizedFilter, changeSetId);
        });
    }
    /**
   * Stops the PXE's operation queue and closes the backing store.
   */ async stop() {
        await this.operationQueue.stop();
        await this.blockStateSynchronizer.stop();
        await this.db.close();
    }
}
