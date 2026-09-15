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
    now = Date.now, wait = sleep, timeoutMs = 15 * 60 * 1000, intervalMs = 15000 }) {
    const deadline = now() + timeoutMs;
    async function finalizedReceipt() {
      const receipt = await node.getTxReceipt(hash);
      if (!receipt || receipt.status === 'pending') return null;
      if (receipt.status === 'dropped') throw new Error('Ready transaction was dropped');
      if (!['proposed', 'checkpointed', 'proven', 'finalized'].includes(receipt.status)) {
        throw new Error('Ready transaction has unknown receipt status');
      }
      if (receipt.executionResult !== 'success') throw new Error('Ready transaction did not execute successfully');
      if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 1 || !receipt.blockHash) {
        throw new Error('Ready transaction has incomplete inclusion metadata');
      }
      if (receipt.status === 'proposed') return null;
      const tips = await node.getChainTips();
      const finalizedNumber = tips?.finalized?.block?.number;
      if (!Number.isSafeInteger(finalizedNumber) || finalizedNumber < 0) throw new Error('Invalid finalized chain tip');
      if (finalizedNumber < receipt.blockNumber) return null;
      const block = await node.getBlock(receipt.blockNumber);
      if (!block || block.hash.toString() !== receipt.blockHash.toString()) return null;
      return receipt;
    }
    while (now() < deadline) {
      const receipt = await finalizedReceipt();
      if (receipt) {
        const witness = await node.getL2ToL1MembershipWitness(hash, leaf);
        if (witness) {
          // Re-read after witness resolution: never activate using a receipt cached before a reorg.
          const current = await finalizedReceipt();
          if (current && current.blockNumber === receipt.blockNumber &&
            current.blockHash.toString() === receipt.blockHash.toString() && now() < deadline) {
            const tx = await portal.activate(BigInt(witness.epochNumber), BigInt(witness.numCheckpointsInEpoch),
              BigInt(witness.leafIndex), witness.siblingPath.toBufferArray().map(bytes => ethers.hexlify(bytes)));
            const activation = await tx.wait();
            if (activation.status !== 1 || !await portal.depositsEnabled()) throw new Error('Portal activation failed');
            return activation;
          }
        }
      }
      log('Waiting for finalized Ready proof; deposits remain disabled.', 'info');
      await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
    }
    throw new Error('Ready proof not finalized within this run; resume with readyTxHash ' + hash.toString());
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
        await a.submitOnceWithReconciliation(rawNode,tx);
        const waitOpts=typeof opts.wait==='object'?opts.wait:{};
        const receipt=await a.waitForSuccessfulReceipt(rawNode,tx,{
          timeoutMs:(waitOpts.timeout ?? 540)*1000,intervalMs:(waitOpts.interval ?? 5)*1000,
          now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
        });
        log('  Tx confirmed! Block: ' + receipt.blockNumber + ', Status: ' + receipt.status, 'success');
        return { receipt };
      }
    }

    const wallet = new AztecWallet(pxe, aztecNode);
    wallet._preProveHook = opts.preProveHook || null;
    wallet._contextGuard = opts.contextGuard || null;
    wallet._secretKey = secretKey;
    return wallet;
  }

  // ============================================================
  // Main entry point
  // ============================================================
  g.runDeploy = async function(env, config) {
    const { aztec: a, ethers, log, pause, initCRS, createStore, portalBytecode, artifact } = env;

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
    const contractSalt = config.contractSalt || 1;
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
    const rawNode = a.createAztecNodeClient(nodeUrl);
    const aztecNode = wrapWithRetry(rawNode, 'node', log);
    const nodeInfo = await aztecNode.getNodeInfo();
    log('  Chain ID: ' + nodeInfo.l1ChainId, 'info');
    log('  Rollup version: ' + nodeInfo.rollupVersion, 'info');

    const l1Contracts = await aztecNode.getL1ContractAddresses();
    const rollupAddr = l1Contracts.rollupAddress.toString();
    const version = nodeInfo.rollupVersion;
    log('  L1 Rollup: ' + rollupAddr, 'info');

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
    const minDepositWei = config.minDepositWei ?? ethers.parseEther('0.001');
    if (config.maxDepositWei == null) throw new Error('Maximum deposit must be configured for this fresh deployment');
    const maxDepositWei = BigInt(config.maxDepositWei);
    const baseCooldown = config.baseCooldown || 3600;
    if (!config.censor || BigInt(config.censor) === 0n) throw new Error('A nonzero censor must be configured');
    const censorAddr = a.AztecAddress.fromFieldUnsafe(a.Fr.fromHexString(config.censor));
    const kMultiplier = config.kMultiplier || 64;
    const censorWindow = config.censorWindow || 3600;
    const maxSaveUp = config.maxSaveUp || 16;
    // Moderation policy: pack string into Field array (48 fields, 1488 bytes max)
    const policyText = config.moderationPolicy !== undefined ? config.moderationPolicy : (g.DEFAULT_MODERATION_POLICY || '');
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

    let existingInstance = null;
    try { existingInstance = await aztecNode.getContract(l2Addr); } catch (e) { /* not deployed */ }

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
      try {
        const result = await deployMethod.send({ from: address });
        log('  TX confirmed! Block: ' + result.receipt.blockNumber, 'success');
        log('  L2 contract address: ' + l2Addr.toString(), 'success');
      } catch (err) {
        if (/existing nullifier|already exists|duplicate/i.test(err.message || '')) {
          log('  Deployment nullifier already consumed. Re-checking...', 'warn');
          let found = false;
          for (let i = 0; i < 10; i++) {
            await sleep(10000);
            try {
              existingInstance = await aztecNode.getContract(l2Addr);
              if (existingInstance) { found = true; break; }
            } catch (e) {}
            log('  Contract not visible yet, retrying... (' + (i+1) + '/10)', 'warn');
          }
        } else { throw err; }
      }
      const finalInstance = existingInstance || await deployMethod.getInstance();
      await pxe.registerContractClass(contractArtifact);
      await pxe.registerContract(finalInstance);
    }

    const l2Contract = await a.Contract.at(l2Addr, contractArtifact, wallet);
    log('  Contract registered with PXE.', 'success');

    const scalar = result => { const value = result?.result ?? result?.value ?? result; return BigInt((value?.inner ?? value).toString()); };
    const readPortal = async () => ethers.getAddress('0x' + scalar(await l2Contract.methods.get_portal().simulate({ from: address })).toString(16).padStart(40, '0'));
    const portalState = await l2Contract.methods.is_portal_set().simulate({ from: address });
    const portalAlreadySet = (portalState?.result ?? portalState?.value ?? portalState) === true;
    const wordHash = (label, words) => {
      const bytes = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', ...words.map(() => 'uint256')],
        [ethers.encodeBytes32String(label), ...words]);
      return '0x' + (BigInt(ethers.sha256(bytes)) >> 8n).toString(16).padStart(64, '0');
    };
    const configHash = wordHash('AZTEC_BB_CONFIG_V1', [1n, BigInt(nodeInfo.l1ChainId), BigInt(rollupAddr),
      BigInt(l2Addr.toString()), BigInt(version), BigInt(minDepositWei), maxDepositWei,
      BigInt(baseCooldown), BigInt(kMultiplier), BigInt(censorWindow), BigInt(maxSaveUp)]);
    if (scalar(await l2Contract.methods.get_config_hash().simulate({ from: address })) !== BigInt(configHash)) {
      throw new Error('Deployed board configuration differs from requested configuration');
    }

    // ============================================================
    // Step 9: Deploy L1 portal (or verify if exists)
    // ============================================================
    log('Step 8: Deploying L1 portal...', 'info');
    const l2AddrHex = '0x' + BigInt(l2Addr.toString()).toString(16).padStart(64, '0');

    // Get ETH signer
    let ethSigner = null;
    if (config.ethWallet && config.ethWallet.privateKey) {
      log('  Using ETH wallet from config (local signing)...', 'info');
      const provider = new ethers.JsonRpcProvider(config.ethRpcUrl);
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
      ethSigner = new ethers.Wallet(ethWalletData.privateKey, provider);
      log('  ETH address: ' + ethSigner.address, 'info');
    }

    let predicted = portalAlreadySet ? await readPortal() : computePortalAddress(portalBytecode, PORTAL_ABI, l2AddrHex, rollupAddr, version, minDepositWei, maxDepositWei, configHash, ethers);
    log('  Predicted portal address: ' + predicted, 'info');

    const provider = ethSigner.provider;
    if ((await provider.getNetwork()).chainId !== BigInt(nodeInfo.l1ChainId)) throw new Error('L1 signer and Aztec node chain mismatch');
    const existingCode = await provider.getCode(predicted);

    if (existingCode !== '0x') {
      log('  Portal already deployed at ' + predicted + '!', 'success');
    } else {
      // Check if CREATE2 proxy exists
      const proxyCode = await provider.getCode(CREATE2_PROXY);
      if (proxyCode === '0x') {
        log('  CREATE2 proxy not found. Falling back to direct deploy...', 'warn');
        log('  WARNING: address will depend on nonce and is NOT deterministic.', 'warn');
        const factory = new ethers.ContractFactory(PORTAL_ABI, portalBytecode, ethSigner);
        const contract = await factory.deploy(rollupAddr, l2AddrHex, BigInt(version), BigInt(minDepositWei), maxDepositWei, configHash);
        log('  Tx sent: ' + contract.deploymentTransaction().hash, 'info');
        await contract.waitForDeployment();
        const addr = await contract.getAddress();
        predicted = addr;
        log('  Portal deployed at ' + addr, 'success');
      } else {
        log('  Deploying via CREATE2 proxy ' + CREATE2_PROXY + '...', 'info');
        const creation = portalCreationBytecode(portalBytecode, PORTAL_ABI, rollupAddr, l2AddrHex, version, minDepositWei, maxDepositWei, configHash, ethers);
        const salt = ethers.getBytes(l2AddrHex);
        const data = ethers.concat([salt, creation]);
        const tx = await ethSigner.sendTransaction({ to: CREATE2_PROXY, data, value: 0 });
        log('  Tx sent: ' + tx.hash, 'info');
        log('  Waiting for confirmation...', 'info');
        const rc = await tx.wait();
        log('  Confirmed in block ' + rc.blockNumber, 'success');
        log('  Portal deployed at ' + predicted, 'success');
      }
    }

    const portal = new ethers.Contract(predicted, PORTAL_ABI, ethSigner);
    const values = await Promise.all([portal.L2_CONTRACT(), portal.ROLLUP(), portal.VERSION(),
      portal.L1_CHAIN_ID(), portal.MIN_DEPOSIT(), portal.MAX_DEPOSIT(), portal.CONFIG_HASH()]);
    const expected = [BigInt(l2AddrHex), BigInt(rollupAddr), BigInt(version), BigInt(nodeInfo.l1ChainId),
      BigInt(minDepositWei), maxDepositWei, BigInt(configHash)];
    if (values.some((value, index) => BigInt(value) !== expected[index])) throw new Error('Portal configuration mismatch');

    let readyTxHash = config.readyTxHash || null;
    if (portalAlreadySet) {
      if ((await readPortal()).toLowerCase() !== predicted.toLowerCase()) throw new Error('Board is bound to another portal');
    } else {
      const result = await l2Contract.methods.update_portal(a.EthAddress.fromString(predicted)).send({ from: address });
      readyTxHash = result.receipt.txHash.toString();
      log('Portal binding transaction: ' + readyTxHash, 'info');
      if ((await readPortal()).toLowerCase() !== predicted.toLowerCase()) throw new Error('Portal binding did not persist');
    }

    if (!await portal.depositsEnabled()) {
      if (!readyTxHash) throw new Error('Portal awaits Ready proof: provide the original readyTxHash to resume activation');
      const ready = wordHash('AZTEC_BB_READY_V1', [1n, BigInt(nodeInfo.l1ChainId), BigInt(predicted),
        BigInt(l2AddrHex), BigInt(version), BigInt(configHash)]);
      // Canonical protocol envelope: 32-byte sender/version, 20-byte recipient, 32-byte chain/content.
      const leaf = a.sha256ToField([l2Addr.toBuffer(), new a.Fr(BigInt(version)).toBuffer(),
        a.EthAddress.fromString(predicted).toBuffer(), new a.Fr(BigInt(nodeInfo.l1ChainId)).toBuffer(),
        new a.Fr(BigInt(ready)).toBuffer()]);
      const hash = a.TxHash.fromString(readyTxHash);
      await activateReady({ node: aztecNode, portal, hash, leaf, ethers, log });
    }
    log('Board and portal are linked; authenticated Ready enabled deposits.', 'success');

    return { l2Addr: l2Addr.toString(), portalAddr: predicted, readyTxHash, configHash };
  };
})();
