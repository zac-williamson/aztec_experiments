// ============================================================
// engine.js — Billboard Deploy Engine
// ============================================================
// Fully abstracted from the interface. Takes an `env` object
// (providing aztec SDK, ethers, logging, pause, CRS init, store
// creation, ETH signer) and a `config` object. Runs the entire
// deploy flow autonomously, only pausing for user input when
// genuinely needed (wallet import).
//
// Works in: browser (bundle), CLI (npm SDK), file:// (single-thread)
//
// Defines: globalThis.runDeploy(env, config) → Promise<result>
// ============================================================

;(function() {
  const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);

  // ============================================================
  // Constants
  // ============================================================
  const TRANSIENT_RE = /temporary internal error|please retry|timeout|fetch|network|connection|ECONNRESET|socket/i;
  const CREATE2_PROXY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

  const PORTAL_ABI = [
    "constructor(address rollup, bytes32 board, uint256 version, uint256 minDeposit, uint256 maxDeposit, bytes32 configHash)",
    "function L2_CONTRACT() view returns (bytes32)",
    "function ROLLUP() view returns (address)",
    "function INBOX() view returns (address)",
    "function OUTBOX() view returns (address)",
    "function VERSION() view returns (uint256)",
    "function L1_CHAIN_ID() view returns (uint256)",
    "function MIN_DEPOSIT() view returns (uint256)",
    "function MAX_DEPOSIT() view returns (uint256)",
    "function CONFIG_HASH() view returns (bytes32)",
    "function depositsEnabled() view returns (bool)",
    "function activate(uint256 epoch, uint256 checkpointCount, uint256 leafIndex, bytes32[] path)",
  ];

  // ============================================================
  // Helpers
  // ============================================================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // This is also the maintained behavioral test seam; runDeploy uses this exact path.
  async function activateReady({ node, portal, hash, leaf, ethers, log,
    timeoutMs = 20000, activate }) {
    // Settlement belongs to the network. Check once and leave a resumable state;
    // do not hold an application run open waiting for an epoch to settle.
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 20000) throw new Error('Invalid Ready check timeout');
    let deadline = Date.now() + timeoutMs;
    const pending = () => {
      log('Portal binding is saved. Network settlement is pending; resume deployment later.', 'info');
      return { status: 'pending-settlement', readyTxHash: hash.toString() };
    };
    async function read(fn) {
      let timer;
      try {
        return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Ready state is unknown; resume deployment to check again.'),
            { code: 'BB_RECOVERY_UNKNOWN' })), Math.max(0, deadline - Date.now()));
        })]);
      } finally { clearTimeout(timer); }
    }
    async function finalizedReceipt() {
      const receipt = await read(() => node.getTxReceipt(hash));
      if (!receipt || receipt.status === 'pending') return null;
      if (receipt.txHash?.toString() !== hash.toString()) throw new Error('Ready receipt transaction hash mismatch');
      if (receipt.status === 'dropped') throw new Error('Ready transaction was dropped');
      if (!['proposed', 'checkpointed', 'proven', 'finalized'].includes(receipt.status)) {
        throw new Error('Ready transaction has unknown receipt status');
      }
      if (receipt.executionResult !== 'success') throw new Error('Ready transaction did not execute successfully');
      if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 1 || !receipt.blockHash) {
        throw new Error('Ready transaction has incomplete inclusion metadata');
      }
      if (receipt.status === 'proposed') return null;
      const tips = await read(() => node.getChainTips());
      const finalizedNumber = tips?.finalized?.block?.number;
      if (!Number.isSafeInteger(finalizedNumber) || finalizedNumber < 0) throw new Error('Invalid finalized chain tip');
      if (finalizedNumber < receipt.blockNumber) return null;
      const block = await read(() => node.getBlock(receipt.blockNumber));
      if (!block || block.hash.toString() !== receipt.blockHash.toString()) return null;
      return receipt;
    }
    const receipt = await finalizedReceipt();
    if (!receipt) return pending();
    const witness = await read(() => node.getL2ToL1MembershipWitness(hash, leaf));
    if (!witness) return pending();
    // A witness obtained before a reorg cannot authorize activation.
    const current = await finalizedReceipt();
    if (!current || current.blockNumber !== receipt.blockNumber ||
      current.blockHash.toString() !== receipt.blockHash.toString()) return pending();
    const args = [BigInt(witness.epochNumber), BigInt(witness.numCheckpointsInEpoch),
      BigInt(witness.leafIndex), witness.siblingPath.toBufferArray().map(bytes => ethers.hexlify(bytes))];
    const activation = activate ? await activate(args) : await (await portal.activate(...args)).wait();
    deadline = Date.now() + timeoutMs;
    if (activation.status !== 1 || !await read(() => portal.depositsEnabled())) throw new Error('Portal activation failed');
    return { status: 'active', receipt: activation };
  }
  g.BillboardDeployActivation = Object.freeze({ activateReady });

  function extractErrorMessage(err) {
    if (!err) return 'Unknown error';
    let msg = err.message || String(err);
    const patterns = [
      /Assertion failed: '([^']+)'/,
      /"message"\s*:\s*"([^"]+)"/,
      /revert: (.+)/,
      /Failed to solve.*?"([^"]{5,200})"/,
      /Error: (.+)/,
    ];
    for (const p of patterns) {
      const m = msg.match(p);
      if (m && m[1]) return m[1];
    }
    if (msg.length > 300) msg = msg.substring(0, 300) + '...';
    return msg;
  }

  function toAztec(bi, decimals = 4) {
    const factor = 10n ** BigInt(decimals);
    return (Number(bi * factor / 10n ** 18n) / Number(factor)).toFixed(decimals);
  }

  // Retry wrapper for transient errors
  async function retry(fn, label, log, maxRetries = 8) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try { return await fn(); }
      catch (err) {
        const isTransient = TRANSIENT_RE.test(err.message || '');
        if (!isTransient || attempt === maxRetries) throw err;
        const delay = 2000 * attempt;
        if (label) log('  [' + label + '] transient error (attempt ' + attempt + '/' + maxRetries + '), retrying in ' + delay/1000 + 's...', 'warn');
        await sleep(delay);
      }
    }
  }

  // Wrap a node client with retry proxy
  function wrapWithRetry(obj, label, log) {
    return new Proxy(obj, {
      get(target, prop) {
        const val = target[prop];
        if (typeof val !== 'function') return val;
        return async (...args) => {
          for (let attempt = 1; attempt <= 8; attempt++) {
            try { return await val.apply(target, args); }
            catch (err) {
              const isTransient = TRANSIENT_RE.test(err.message || '');
              if (!isTransient || attempt === 8) throw err;
              const delay = 2000 * attempt;
              if (label) log('  [' + label + '.' + String(prop) + '] transient error (attempt ' + attempt + '/8), retrying in ' + delay/1000 + 's...', 'warn');
              await sleep(delay);
            }
          }
        };
      }
    });
  }

  // CREATE2 portal address computation
  function portalCreationBytecode(portalBytecode, portalAbi, rollup, l2AddrHex, version, minDeposit, maxDeposit, configHash, ethers) {
    const iface = new ethers.Interface(portalAbi);
    const encodedArgs = iface.encodeDeploy([rollup, l2AddrHex, BigInt(version), BigInt(minDeposit), BigInt(maxDeposit), configHash]);
    return ethers.concat([portalBytecode, encodedArgs]);
  }

  function computePortalAddress(portalBytecode, portalAbi, l2AddrHex, rollup, version, minDeposit, maxDeposit, configHash, ethers) {
    const creation = portalCreationBytecode(portalBytecode, portalAbi, rollup, l2AddrHex, version, minDeposit, maxDeposit, configHash, ethers);
    const salt = ethers.getBytes(l2AddrHex);
    const initCodeHash = ethers.keccak256(creation);
    return ethers.getCreate2Address(CREATE2_PROXY, salt, initCodeHash);
  }

  // ============================================================
  // Aztec Wallet (custom BaseWallet with gas estimation + retry)
  // ============================================================
  function createAztecWallet(a, pxe, aztecNode, rawNode, log, secretKey, opts = {}) {
    class AztecWallet extends a.BaseWallet {
      constructor(pxe, aztecNode) {
        super(pxe, aztecNode);
        this._accountManager = null;
        this._account = null;
        this._estimatedGasPadding = 0.1;
        this._secretKey = null;
      }
      async registerContract(instance, artifact, secretKeyOrKeys) {
        // Only pass secretKeyOrKeys when the contract instance is the account
        // contract itself (address matches). For non-account contracts (like
        // the billboard), registering with keys would fail because the public
        // keys in the instance don't match the account's keys.
        if (secretKeyOrKeys || (this._account && instance.address.equals(this._account.address))) {
          return super.registerContract(instance, artifact, secretKeyOrKeys ?? this._secretKey);
        }
        return super.registerContract(instance, artifact);
      }
      async getAccountFromAddress() {
        if (!this._account) this._account = await this._accountManager.getAccount();
        return this._account;
      }
      getAccounts() {
        return this._accountManager ? Promise.resolve([this._accountManager.address]) : Promise.resolve([]);
      }

      async sendTx(executionPayload, opts) {
        const previousJournal = this._transactionJournal ? await this._transactionJournal.assertCanStart() : null;
        log('  Estimating gas (simulating tx)...', 'info');
        const feeOptions = await this.completeFeeOptions({
          from: opts.from,
          feePayer: executionPayload.feePayer,
          gasSettings: opts.fee?.gasSettings,
          forEstimation: true,
        });

        const simResult = await retry(
          () => this.simulateViaEntrypoint(executionPayload, {
            from: opts.from, feeOptions, skipTxValidation: true, skipFeeEnforcement: true,
            additionalScopes: opts.additionalScopes, sendMessagesAs: opts.sendMessagesAs,
          }),
          'simulation', log, 5
        );

        const gu = simResult.gasUsed;
        const pad = 1 + this._estimatedGasPadding;
        const gasLimits = gu.totalGas.mul(pad);
        const teardownGasLimits = gu.teardownGas.mul(pad);
        const maxFee = gasLimits.computeFee(feeOptions.gasSettings.maxFeesPerGas).toBigInt();

        log('  Estimated gas: L2=' + gasLimits.l2Gas.toLocaleString() + ' DA=' + gasLimits.daGas.toLocaleString(), 'info');
        log('  Max fee: ' + maxFee.toLocaleString() + ' Fee Juice (' + toAztec(maxFee, 4) + ' AZTEC)', 'info');

        if (this._preProveHook) {
          await this._preProveHook({ gasLimits, maxFee, feeOptions, teardownGasLimits });
        }

        const finalGasSettings = a.GasSettings.from({
          gasLimits: opts.fee?.gasSettings?.gasLimits ?? gasLimits,
          teardownGasLimits: opts.fee?.gasSettings?.teardownGasLimits ?? teardownGasLimits,
          maxFeesPerGas: feeOptions.gasSettings.maxFeesPerGas,
          maxPriorityFeesPerGas: feeOptions.gasSettings.maxPriorityFeesPerGas,
        });

        log('  Proving tx (can take minutes)...', 'info');

        const feeOpts2 = await this.completeFeeOptions({
          from: opts.from, feePayer: executionPayload.feePayer, gasSettings: finalGasSettings,
        });
        const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(executionPayload, opts.from, feeOpts2);
        const provenTx = await this.pxe.proveTx(txRequest, {
          scopes: this.scopesFrom(opts.from, opts.additionalScopes),
          senderForTags: this.senderForTagsFrom(opts.from, opts.sendMessagesAs),
        });
        const tx = await provenTx.toTx();
        const txHash = tx.getTxHash();
        log('  Proving complete. Submitting to node...', 'success');

        log('  Transaction hash: ' + txHash.toString(), 'info');
        if(this._contextGuard)await this._contextGuard();
        if (this._transactionJournal) await this._transactionJournal.prepare(tx, previousJournal);
        await a.submitOnceWithReconciliation(rawNode,tx);
        const waitOpts=typeof opts.wait==='object'?opts.wait:{};
        const receipt=await a.waitForSuccessfulReceipt(rawNode,tx,{
          timeoutMs:(waitOpts.timeout ?? 540)*1000,intervalMs:(waitOpts.interval ?? 5)*1000,
          now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
        });
        if (this._transactionJournal) this._transactionJournal.confirmed(receipt);
        log('  Tx confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
        return { receipt };
      }
    }

    const wallet = new AztecWallet(pxe, aztecNode);
    wallet._preProveHook = opts.preProveHook || null;
    wallet._contextGuard = opts.contextGuard || null;
    wallet._transactionJournal = opts.transactionJournal || null;
    wallet._secretKey = secretKey;
    return wallet;
  }

  // ============================================================
  // Main entry point
  // ============================================================
  g.runDeploy = async function(env, config) {
    const { aztec: a, ethers, log, pause, initCRS, createStore, portalBytecode, artifact } = env;
    const verified=a.verifyDeploymentInputs(config.deploymentManifest,{artifact,portalBytecode,runtimeMetadata:a.portalRuntimeMetadata,config,ethers});
    const manifest=verified.manifest;
    const rawNode=a.createAztecNodeClient(config.aztecNodeUrl);
    const ownedProviders=new Set();
    try {
    const preflightProvider=new ethers.JsonRpcProvider(config.ethRpcUrl);
    ownedProviders.add(preflightProvider);
    const {nodeInfo,l1Contracts}=await a.preflightDeploymentNetwork(manifest,{node:rawNode,provider:preflightProvider,ethers});
    const expectedClass=await a.getContractClassFromArtifact(a.loadContractArtifact(artifact));
    if(expectedClass.id.toString().toLowerCase()!==manifest.artifacts.boardClassId)throw new Error('Deployment board class mismatch');


    // ============================================================
    // Step 1: Load Aztec wallet
    // ============================================================
    let aztecWallet = config.aztecWallet;
    if (!aztecWallet || !aztecWallet.secretKey) {
      log('Aztec wallet not provided. Pausing for user to import...', 'info');
      aztecWallet = await pause('import-aztec-wallet');
      if (!aztecWallet || !aztecWallet.secretKey) throw new Error('Aztec wallet is required.');
    }

    const saltVal = BigInt(aztecWallet.salt ?? 0);
    const contractSalt = config.contractSalt;
    const secretKeyHex = aztecWallet.secretKey;

    // ============================================================
    // Step 2: Derive account keys
    // ============================================================
    log('Step 1: Deriving account keys...', 'info');
    const secretKey = a.Fr.fromHexString(secretKeyHex);
    const signingKey = a.deriveSigningKey(secretKey);
    const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
    const { publicKeys } = await a.deriveKeys(secretKey);
    const accountArtifact = await accountContract.getContractArtifact();
    const immutablesHash = await accountContract.getImmutablesHash();
    const instance = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
      constructorArtifact: undefined, constructorArgs: undefined,
      salt: new a.Fr(saltVal), publicKeys, immutablesHash,
    });
    const partialAddress = await a.computePartialAddress(instance);
    const address = instance.address;
    log('  Address: ' + address.toString(), 'success');

    // ============================================================
    // Step 3: Connect to Aztec node
    // ============================================================
    log('Step 2: Connecting to Aztec node...', 'info');
    const nodeUrl = config.aztecNodeUrl;

    const aztecNode = wrapWithRetry(rawNode, 'node', log);

    log('  Chain ID: ' + nodeInfo.l1ChainId, 'info');
    log('  Rollup version: ' + nodeInfo.rollupVersion, 'info');


    const rollupAddr = l1Contracts.rollupAddress.toString();
    const version = nodeInfo.rollupVersion;
    log('  L1 Rollup: ' + rollupAddr, 'info');
    if(address.toString().toLowerCase()!==manifest.actors.aztecDeployer)throw new Error('Aztec deployer differs from manifest');
    // Get ETH signer
    let ethSigner = null;
    if (config.ethWallet && config.ethWallet.privateKey) {
      log('  Using ETH wallet from config (local signing)...', 'info');
      const provider = new ethers.JsonRpcProvider(config.ethRpcUrl);
      ownedProviders.add(provider);
      ethSigner = new ethers.Wallet(config.ethWallet.privateKey, provider);
      log('  ETH address: ' + ethSigner.address, 'info');
    } else if (env.getBrowserSigner) {
      log('  Using browser wallet...', 'info');
      ethSigner = await env.getBrowserSigner();
    } else {
      log('  No ETH wallet in config and no browser wallet. Pausing for user to import...', 'info');
      const ethWalletData = await pause('import-eth-wallet');
      if (!ethWalletData || !ethWalletData.privateKey) throw new Error('ETH wallet is required.');
      const provider = new ethers.JsonRpcProvider(config.ethRpcUrl);
      ownedProviders.add(provider);
      ethSigner = new ethers.Wallet(ethWalletData.privateKey, provider);
      log('  ETH address: ' + ethSigner.address, 'info');
    }

    const provider = ethSigner.provider;
    if ((await a.boundedTransactionRead(()=>provider.getNetwork(),20000)).chainId !== BigInt(nodeInfo.l1ChainId)) throw new Error('L1 signer and Aztec node chain mismatch');

    if((await ethSigner.getAddress()).toLowerCase()!==manifest.actors.ethereumDeployer)throw new Error('Ethereum deployer differs from manifest');
    await a.preflightDeploymentNetwork(manifest,{node:rawNode,provider,ethers});


    // Check fee juice balance
    try {
      const blockNum = await aztecNode.getBlockNumber();
      log('  Current L2 block: ' + blockNum, 'info');
    } catch (e) { /* non-critical */ }

    log('Checking Fee Juice balance...', 'info');
    try {
      const slot = await a.deriveStorageSlotInMap(new a.Fr(1), address);
      const value = await aztecNode.getPublicStorageAt('latest', a.FeeJuiceAddress, slot);
      const balance = value ? BigInt(value.toString()) : 0n;
      log('  Fee Juice balance: ' + toAztec(balance, 6) + ' AZTEC', balance > 0n ? 'success' : 'warn');
      if (balance === 0n) {
        log('  WARNING: No Fee Juice. You need some to pay for deployment tx fees.', 'warn');
      }
    } catch (e) {
      log('  Could not check balance: ' + 'operation did not complete; check configuration and recovery records', 'warn');
    }

    // ============================================================
    // Step 4: Initialize CRS
    // ============================================================
    log('Step 3: Initializing CRS...', 'info');
    await initCRS();
    log('  CRS ready.', 'success');

    // ============================================================
    // Step 5: Create PXE
    // ============================================================
    log('Step 4: Creating PXE...', 'info');
    const dataDirPrefix = (config.dataDirPrefix || 'pxe_bb_') + address.toString().slice(0, 16) + '_';
    const storeConfig = { ...l1Contracts, l1ChainId: nodeInfo.l1ChainId, accountAddress: address.toString(), dataDirectory: dataDirPrefix + l1Contracts.rollupAddress };
    const store = await createStore(storeConfig);
    const pxe = await a.createPXE(aztecNode, {
      proverEnabled: true, autoSync: true,
      dataDirectory: dataDirPrefix + l1Contracts.rollupAddress,
    }, { store });
    log('  PXE created.', 'success');
    try {

    // ============================================================
    // Step 6: Register account + sync
    // ============================================================
    log('Step 5: Registering account with PXE...', 'info');
    const derivedKeys = await a.deriveKeys(secretKey);
    await pxe.registerAccount(derivedKeys, partialAddress);
    log('  Account registered.', 'success');

    log('  Registering Schnorr initializerless account contract...', 'info');
    await retry(() => pxe.registerContractClass(a.SchnorrInitializerlessAccountContractArtifact), 'register', log, 5);
    await retry(() => pxe.registerContract(instance), 'register', log, 5);
    log('  Contract registered.', 'success');

    log('  Syncing PXE with node...', 'info');
    await pxe.sync();
    log('  PXE synced.', 'success');

    // ============================================================
    // Step 7: Create wallet
    // ============================================================
    log('Step 6: Creating wallet...', 'info');
    const wallet = createAztecWallet(a, pxe, aztecNode, rawNode, log, secretKey, { preProveHook: config.preProveHook, contextGuard: config.contextGuard });
    const accountManager = await a.AccountManager.create(wallet, secretKey, accountContract, { salt: new a.Fr(saltVal) });
    wallet._accountManager = accountManager;
    log('  Wallet ready.', 'success');

    // Store signing key capsule for initializerless account contract
    log('  Storing signing key capsule...', 'info');
    const signingPublicKey = await accountContract.getSigningPublicKey();
    const constructorArtifact = accountArtifact.functions.find(f => f.name === 'constructor');
    if (constructorArtifact) {
      const storeCall = new a.ContractFunctionInteraction(
        wallet, instance.address, constructorArtifact,
        [signingPublicKey.x, signingPublicKey.y]
      );
      await storeCall.simulate({ from: instance.address });
      log('  Capsule stored.', 'success');
    }

    // ============================================================
    // Step 8: Deploy L2 contract (or register if exists)
    // ============================================================
    log('Step 7: Deploying L2 contract...', 'info');
    const contractArtifact = a.loadContractArtifact(artifact);
    // Constructor args for init(min_deposit, base_cooldown, censor, k,
    //                          censor_window, max_save_up, policy, policy_len)
    const minDepositWei = config.minDepositWei;
    if (config.maxDepositWei == null) throw new Error('Maximum deposit must be configured for this fresh deployment');
    const maxDepositWei = BigInt(config.maxDepositWei);
    const baseCooldown = config.baseCooldown;
    if (!config.censor || BigInt(config.censor) === 0n) throw new Error('A nonzero censor must be configured');
    const censorAddr = a.AztecAddress.fromFieldUnsafe(a.Fr.fromHexString(config.censor));
    const kMultiplier = config.kMultiplier;
    const censorWindow = config.censorWindow;
    const maxSaveUp = config.maxSaveUp;
    // Moderation policy: pack string into Field array (48 fields, 1488 bytes max)
    const policyText = config.moderationPolicy;
    const packFn = g.packStringToFields;
    if (!packFn) throw new Error('packStringToFields not available (load moderation-policy.js)');
    const { fields: policyFields, len: policyLen } = packFn(policyText);
    log('  Min deposit:    ' + ethers.formatEther(minDepositWei) + ' ETH', 'info');
    log('  Base cooldown:  ' + baseCooldown + 's (' + Math.floor(baseCooldown/60) + ' min)', 'info');
    log('  Censor:         ' + censorAddr.toString(), 'info');
    log('  K multiplier:   ' + kMultiplier, 'info');
    log('  Censor window:  ' + censorWindow + 's', 'info');
    log('  Max save up:    ' + maxSaveUp, 'info');
    log('  Policy:         ' + policyLen + ' bytes', 'info');
    const initArgs = [
      BigInt(nodeInfo.l1ChainId), a.EthAddress.fromString(rollupAddr), BigInt(version),
      new a.Fr(BigInt(minDepositWei)), new a.Fr(maxDepositWei),
      new a.Fr(BigInt(baseCooldown)),
      censorAddr.toField(),
      new a.Fr(BigInt(kMultiplier)),
      new a.Fr(BigInt(censorWindow)),
      new a.Fr(BigInt(maxSaveUp)),
      policyFields.map(f => new a.Fr(f)),
      new a.Fr(BigInt(policyLen)),
    ];
    // Use universalDeploy + fixed public keys (derived from zero secret key)
    const universalPublicKeys = (await a.deriveKeys(a.Fr.ZERO)).publicKeys;
    const deployMethod = a.Contract.deploy(wallet, contractArtifact, initArgs, undefined, {
      salt: new a.Fr(contractSalt),
      publicKeys: universalPublicKeys,
      universalDeploy: true,
    });

    const l2Addr = await deployMethod.getAddress();
    log('  Predicted L2 address: ' + l2Addr.toString(), 'info');

    if (typeof env.createTransactionJournal !== 'function') throw Object.assign(new Error('Deployment recovery storage is required.'), { code: 'BB_JOURNAL_INVALID' });
    const deploymentJournal = await env.createTransactionJournal({ walletSecret: secretKeyHex, walletSalt: saltVal,
      scope: { account: address.toString().toLowerCase(), chainId: String(nodeInfo.l1ChainId), rollup: rollupAddr.toLowerCase(),
        version: String(version), board: l2Addr.toString().toLowerCase(), portal: '0x' + '0'.repeat(40) },
      Tx: a.Tx, node: rawNode, contextGuard: config.contextGuard });
    let recoveredDeployment=null, staleDeployment=null;
    const unresolved=()=>Object.assign(new Error('The original deployment transaction requires reconciliation. Preserve its recovery records.'),{code:'BB_RECOVERY_REQUIRED'});
    try { recoveredDeployment = await deploymentJournal.reconcilePrevious(); }
    catch(error) {
      if(error?.code!=='BB_RECOVERY_REQUIRED'||typeof deploymentJournal.inspect!=='function'||typeof deploymentJournal.allowReplacement!=='function')throw error;
      const saved=await deploymentJournal.inspect();
      if(saved?.operation!=='deploy-board'&&!/^bind-portal:0x[0-9a-f]{40}$/.test(saved?.operation??''))throw error;
      await deploymentJournal.allowReplacement(saved.operation);
      staleDeployment=saved.operation;
    }
    await deploymentJournal.assertCanStart();
    wallet._transactionJournal = deploymentJournal;
    let existingInstance = await a.boundedTransactionRead(()=>rawNode.getContract(l2Addr),20000);
    if(staleDeployment==='deploy-board'&&existingInstance)throw unresolved();
    if(staleDeployment?.startsWith('bind-portal:')&&!existingInstance)throw unresolved();

    if (existingInstance) {
      log('  Contract already deployed on L2!', 'success');
      const newInstance = await deployMethod.getInstance();
      const newClassId = newInstance.currentContractClassId?.toString?.() || '(unknown)';
      const existingClassId = existingInstance.currentContractClassId?.toString?.() || '(unknown)';
      log('  Class ID (new artifact):  ' + newClassId, 'info');
      log('  Class ID (on-chain):      ' + existingClassId, 'info');
      if (newClassId !== existingClassId) {
        log('  ERROR: Class IDs do NOT match!', 'error');
        log('  A contract was previously deployed at this address with an older artifact.', 'error');
        log('  -> Use a salt that was NEVER used before.', 'error');
        throw new Error('On-chain class ID (' + existingClassId + ') does not match current artifact (' + newClassId + '). Use a new salt.');
      }
      await pxe.registerContractClass(contractArtifact);
      await pxe.registerContract(existingInstance);
    } else {
      log('  Not yet deployed. Sending deploy tx...', 'info');
      deploymentJournal.setOperation('deploy-board');
      const result = await deployMethod.send({ from: address });
      log('  TX confirmed! Block: ' + result.receipt.blockNumber, 'success');
      log('  L2 contract address: ' + l2Addr.toString(), 'success');
      const finalInstance = existingInstance || await deployMethod.getInstance();
      await pxe.registerContractClass(contractArtifact);
      await pxe.registerContract(finalInstance);
    }

    const deployedInstance=await a.boundedTransactionRead(()=>rawNode.getContract(l2Addr),20000);
    if(!deployedInstance || ['originalContractClassId','currentContractClassId'].some(key=>deployedInstance[key]?.toString().toLowerCase()!==manifest.artifacts.boardClassId))throw new Error('Deployed board original/current class identity mismatch');
    const l2Contract = await a.Contract.at(l2Addr, contractArtifact, wallet);
    log('  Contract registered with PXE.', 'success');

    const scalar = result => { const value = result?.result ?? result?.value ?? result; return BigInt((value?.inner ?? value).toString()); };
    const readPortal = async () => ethers.getAddress('0x' + scalar(await a.boundedTransactionRead(()=>l2Contract.methods.get_portal().simulate({ from: address }),20000)).toString(16).padStart(40, '0'));
    const portalState = await a.boundedTransactionRead(()=>l2Contract.methods.is_portal_set().simulate({ from: address }),20000);
    const portalAlreadySet = portalState?.result ?? portalState?.value ?? portalState;
    if(typeof portalAlreadySet!=='boolean')throw new Error('Malformed portal binding state');
    if(staleDeployment?.startsWith('bind-portal:')&&portalAlreadySet)throw unresolved();
    const wordHash = (label, words) => {
      const bytes = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', ...words.map(() => 'uint256')],
        [ethers.encodeBytes32String(label), ...words]);
      return '0x' + (BigInt(ethers.sha256(bytes)) >> 8n).toString(16).padStart(64, '0');
    };
    const configHash = wordHash('AZTEC_BB_CONFIG_V1', [1n, BigInt(nodeInfo.l1ChainId), BigInt(rollupAddr),
      BigInt(l2Addr.toString()), BigInt(version), BigInt(minDepositWei), maxDepositWei,
      BigInt(baseCooldown), BigInt(kMultiplier), BigInt(censorWindow), BigInt(maxSaveUp)]);
    const expectedPolicyVersion=await a.deploymentPolicyVersion(l2Addr.toString().toLowerCase(),policyText);
    const verifyBoardPolicy=async()=>{
      const [censor,policy]=await a.boundedTransactionRead(()=>Promise.all([l2Contract.methods.get_censor().simulate({from:address}),l2Contract.methods.get_policy_version().simulate({from:address})]),20000);
      if(scalar(censor)!==BigInt(manifest.board.censor)||scalar(policy)!==BigInt(expectedPolicyVersion))throw new Error('Board censor or policy differs from manifest');
    };
    await verifyBoardPolicy();
    if (scalar(await a.boundedTransactionRead(()=>l2Contract.methods.get_config_hash().simulate({ from: address }),20000)) !== BigInt(configHash)) {
      throw new Error('Deployed board configuration differs from requested configuration');
    }

    // ============================================================
    // Step 9: Deploy L1 portal (or verify if exists)
    // ============================================================
    log('Step 8: Deploying L1 portal...', 'info');
    const l2AddrHex = '0x' + BigInt(l2Addr.toString()).toString(16).padStart(64, '0');

    if (typeof env.createJournalStorage !== 'function' || typeof a.createEthereumJournal !== 'function') throw Object.assign(new Error('Ethereum deployment recovery storage is required.'), { code: 'BB_JOURNAL_INVALID' });
    const creation = portalCreationBytecode(portalBytecode, PORTAL_ABI, rollupAddr, l2AddrHex, version, minDepositWei, maxDepositWei, configHash, ethers);
    const ethereumScope = { account: address.toString().toLowerCase(), chainId: String(nodeInfo.l1ChainId),
      rollup: rollupAddr.toLowerCase(), version: String(version), board: l2AddrHex.toLowerCase(),
      portal: '0x' + '0'.repeat(40), depositor: (await ethSigner.getAddress()).toLowerCase(), deployment: ethers.keccak256(creation) };
    const ethereumOptions = { storage: env.createJournalStorage(), walletSecret: secretKeyHex, walletSalt: saltVal,
      scope: ethereumScope, provider, signer: ethSigner, contextGuard: config.contextGuard };
    const ethereumDeployment = await a.createEthereumJournal(ethereumOptions);
    let recoveredCreation = await ethereumDeployment.reconcilePrevious({ retry: config.retryEthereum === true });
    let predicted = portalAlreadySet ? await readPortal() : recoveredCreation?.outcome === 'success'
      ? recoveredCreation.request.expected.portal
      : computePortalAddress(portalBytecode, PORTAL_ABI, l2AddrHex, rollupAddr, version, minDepositWei, maxDepositWei, configHash, ethers);
    if(staleDeployment?.startsWith('bind-portal:')) {
      const originalPortal=staleDeployment.slice('bind-portal:'.length);
      if(recoveredCreation?.outcome==='success'&&recoveredCreation.request.expected.portal.toLowerCase()!==originalPortal)throw unresolved();
      predicted=originalPortal;
    }
    log('  Portal address: ' + predicted, 'info');
    if (await a.boundedTransactionRead(()=>provider.getCode(predicted),20000) === '0x') {
      if(staleDeployment?.startsWith('bind-portal:'))throw unresolved();
      if (portalAlreadySet) throw new Error('The bound portal has no code; preserve deployment recovery records.');
      const proxyCode=await a.boundedTransactionRead(()=>provider.getCode(CREATE2_PROXY),20000);
      const pinnedProxy='0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';
      if(proxyCode!=='0x'&&proxyCode.toLowerCase()!==pinnedProxy)throw new Error('Unsupported CREATE2 proxy runtime');
      const hasProxy=proxyCode!=='0x';
      const result = await ethereumDeployment.send(nonce => {
        const portalAddress = hasProxy ? predicted.toLowerCase() : ethers.getCreateAddress({ from: ethereumScope.depositor, nonce }).toLowerCase();
        return { data: hasProxy ? ethers.concat([ethers.getBytes(l2AddrHex), creation]) : creation, value: '0',
          expected: { kind: hasProxy ? 'create2-portal' : 'create-portal', portal: portalAddress } };
      });
      recoveredCreation = result;
      predicted = result.request.expected.portal;
      log('  Portal deployment confirmed: ' + result.txHash, 'success');
    }

    await a.preflightDeploymentNetwork(manifest,{node:rawNode,provider,ethers});
    a.verifyPortalRuntime(await a.boundedTransactionRead(()=>provider.getCode(predicted),20000),a.portalRuntimeMetadata,{MIN_DEPOSIT:BigInt(minDepositWei),MAX_DEPOSIT:maxDepositWei,L2_CONTRACT:l2AddrHex,ROLLUP:manifest.network.rollup,INBOX:manifest.network.inbox,OUTBOX:manifest.network.outbox,VERSION:BigInt(version),L1_CHAIN_ID:BigInt(nodeInfo.l1ChainId),CONFIG_HASH:configHash});
    const portal = new ethers.Contract(predicted, PORTAL_ABI, ethSigner);
    const values = await a.boundedTransactionRead(()=>Promise.all([portal.L2_CONTRACT(), portal.ROLLUP(), portal.VERSION(),
      portal.L1_CHAIN_ID(), portal.MIN_DEPOSIT(), portal.MAX_DEPOSIT(), portal.CONFIG_HASH(),portal.INBOX(),portal.OUTBOX()]),20000);
    const expected = [BigInt(l2AddrHex), BigInt(rollupAddr), BigInt(version), BigInt(nodeInfo.l1ChainId),
      BigInt(minDepositWei), maxDepositWei, BigInt(configHash),BigInt(manifest.network.inbox),BigInt(manifest.network.outbox)];
    if (values.some((value, index) => BigInt(value) !== expected[index])) throw new Error('Portal configuration mismatch');

    const recoveredBindingHash = recoveredDeployment?.operation === 'bind-portal:' + predicted.toLowerCase() &&
      recoveredDeployment.receipt.executionResult === 'success' ? recoveredDeployment.receipt.txHash.toString() : null;
    if (config.readyTxHash && recoveredBindingHash && config.readyTxHash !== recoveredBindingHash) throw new Error('Supplied binding hash differs from the saved transaction');
    let readyTxHash = recoveredBindingHash || config.readyTxHash || null;
    if (portalAlreadySet) {
      if ((await readPortal()).toLowerCase() !== predicted.toLowerCase()) throw new Error('Board is bound to another portal');
    } else {
      deploymentJournal.setOperation('bind-portal:' + predicted.toLowerCase());
      const result = await l2Contract.methods.update_portal(a.EthAddress.fromString(predicted)).send({ from: address });
      readyTxHash = result.receipt.txHash.toString();
      log('Portal binding transaction: ' + readyTxHash, 'info');
      if ((await readPortal()).toLowerCase() !== predicted.toLowerCase()) throw new Error('Portal binding did not persist');
    }

    await verifyBoardPolicy();
    const ethereumActivation = await a.createEthereumJournal({ ...ethereumOptions, scope: { ...ethereumScope, portal: predicted.toLowerCase() },
      minimumNonce: recoveredCreation ? recoveredCreation.request.nonce + 1 : 0 });
    await ethereumActivation.reconcilePrevious({ retry: config.retryEthereum === true });
    const depositsEnabled=await a.boundedTransactionRead(()=>portal.depositsEnabled(),20000);
    if(typeof depositsEnabled!=='boolean')throw new Error('Malformed portal deposit state');
    if (!depositsEnabled) {
      if (!readyTxHash) throw new Error('Portal awaits Ready proof: provide the original readyTxHash to resume activation');
      const ready = wordHash('AZTEC_BB_READY_V1', [1n, BigInt(nodeInfo.l1ChainId), BigInt(predicted),
        BigInt(l2AddrHex), BigInt(version), BigInt(configHash)]);
      // Canonical protocol envelope: 32-byte sender/version, 20-byte recipient, 32-byte chain/content.
      const leaf = a.sha256ToField([l2Addr.toBuffer(), new a.Fr(BigInt(version)).toBuffer(),
        a.EthAddress.fromString(predicted).toBuffer(), new a.Fr(BigInt(nodeInfo.l1ChainId)).toBuffer(),
        new a.Fr(BigInt(ready)).toBuffer()]);
      const hash = a.TxHash.fromString(readyTxHash);
      const activation = await activateReady({ node: rawNode, portal, hash, leaf, ethers, log,
        activate: async args => (await ethereumActivation.send({ data: new ethers.Interface(PORTAL_ABI).encodeFunctionData('activate', args),
          value: '0', expected: { kind: 'activate-portal', portal: predicted.toLowerCase(), configHash: configHash.toLowerCase() } })).receipt });
      if (activation.status !== 'active') return { l2Addr: l2Addr.toString(), portalAddr: predicted, readyTxHash, configHash, intentDigest:verified.intentDigest, policyVersion:expectedPolicyVersion, status: activation.status };
    }
    await verifyBoardPolicy();
    log('Board and portal are linked; authenticated Ready enabled deposits.', 'success');

    return { l2Addr: l2Addr.toString(), portalAddr: predicted, readyTxHash, configHash, intentDigest:verified.intentDigest, policyVersion:expectedPolicyVersion, status: 'active' };
    } finally { await pxe.stop(); }
    } finally { for(const provider of ownedProviders)provider.destroy(); }
  };
})();
