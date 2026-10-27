import {LazyArtifactProvider} from '@aztec-labs/noir-protocol-circuits-types/client/lazy';
import {createPostingKernelPreload} from './posting-kernel-preload.mjs';
// Reuse native dynamic-import caching; never build a second circuit cache.
export const preloadPostingKernels=createPostingKernelPreload(new LazyArtifactProvider());
export {prepareBokCreditPurchase} from './rolling/bok-credit-purchase.mjs';
export {createEncryptedJournalSlot} from './journal-record.mjs';
export {prepareAggregateFunding, validateAggregateFundingQuote, encodeAggregateFundingTransaction, aggregateFundingTransaction, prepareAggregateUsdcFunding, aggregateUsdcFundingTransaction} from './rolling/aggregate-funding.mjs';
export {validateAggregateFundingIntent, verifyAggregateFundingEffects} from './rolling/aggregate-recovery.mjs';
import './browser-runtime-policy.mjs';
export {prepareFundingClaim,prepareBokMessageClaim} from './rolling/funding-receipts.mjs';

// Legacy application consumers require the browser Buffer global.
import { Buffer } from 'node:buffer';
globalThis.Buffer ??= Buffer;

// Explicit browser/CLI compatibility surface for the pinned Aztec SDK.
// Build this source; do not recover exports by editing a generated bundle.
export { createTrustedPrivateNode, inspectTrustedNode, isTrustedPrivateNode, getTrustedNodeSnapshotInfo, getTrustedNodeCanonicalBlock } from './trusted-private-node.mjs';
export { createPXE, preparePrivatePXE, preparePrivatePXEArtifacts, isPrivatePXEForNode, initializeBrowserProver, initializeCliProver, initializePrivateExecution } from './private-pxe.mjs';
export { recordProofTimings, beginProofSpan, measureProofPhase } from './proof-timings.mjs';
export {prefetchBoardClaimWitnesses,prefetchBokClaimWitnesses} from './board-claim-witnesses.mjs';
export {prefetchOrdinaryPostWitnesses} from './ordinary-post-witnesses.mjs';
export { boundedTransactionRead, requireSuccessfulReceipt, submitOnceWithReconciliation, classifyDroppedTransaction, waitForSuccessfulReceipt } from './transaction-outcomes.mjs';
export { openPXEStore, getPXEStoreIdentity, PXE_DATA_SCHEMA_VERSION } from './sdk-store.mjs';
export { AztecSQLiteOPFSStore } from '@aztec-labs/kv-store/sqlite-opfs';
export { BaseWallet } from '@aztec-labs/wallet-sdk/base-wallet';
export { AccountManager, DeployAccountMethod } from '@aztec-labs/aztec.js/wallet';
export { AztecAddress, CompleteAddress, EthAddress } from '@aztec-labs/aztec.js/addresses';
export { Fr } from '@aztec-labs/aztec.js/fields';
export { GrumpkinScalar } from '@aztec-labs/foundation/curves/grumpkin';
export { Contract, ContractFunctionInteraction, BatchCall, DeployMethod, NO_WAIT,
  getContractClassFromArtifact, getContractInstanceFromInstantiationParams } from '@aztec-labs/aztec.js/contracts';
export { NO_FROM } from '@aztec-labs/aztec.js/account';
export { createPrivateFeeDeployment, normalizePrivateFeeGasSettings, preparePrivateFeePayment, derivePrivateFeeInstance, derivePrivateFeeBridgeSecret, derivePrivateFeeAddress } from './private-fee-client.mjs';
export { ensureOnboardingFees } from './fee-onboarding.mjs';
export { fundPrivateFees, recoverPrivateFeeClaim, recoverPrivateFeeFunding, isPrivateFeeClaimConsumed, claimSecrets } from './private-fee-funding.mjs';
export { EventSelector, decodeFunctionSignature } from '@aztec-labs/stdlib/abi';
export { FunctionCall, FunctionSelector, FunctionType, encodeArguments, loadContractArtifact } from '@aztec-labs/aztec.js/abi';
export { Capsule, HashedValues, ExecutionPayload, TxExecutionRequest, TxHash } from '@aztec-labs/aztec.js/tx';
export { createEthereumJournal, verifyEthereumIntentReceipt } from './ethereum-journal.mjs';
export { createL2Journal } from './l2-journal.mjs';
export { createBrowserJournalStorage } from './journal-indexeddb.mjs';
export { Tx, TxContext } from '@aztec-labs/stdlib/tx';
export { Gas, GasSettings } from '@aztec-labs/stdlib/gas';
export { MerkleTreeId } from '@aztec-labs/stdlib/trees';
export { computePartialAddress, computeContractAddressFromInstance, computeArtifactHash, SerializableContractInstance } from '@aztec-labs/stdlib/contract';
export { deriveKeys, deriveKeysFromMasterSecretKeys, deriveMasterNullifierHidingSecretKey, computeAppNullifierHidingKey, deriveMasterMessageSigningSecretKey,
  deriveMasterMessageSigningSecretKey as deriveSigningKey,
  deriveMasterMessageSigningSecretKey as deriveMasterMessageSigningSecretKeyAlias } from '@aztec-labs/stdlib/keys';
export { computeL2ToL1MessageHash, computeSecretHash, deriveStorageSlotInMap, siloNullifier } from '@aztec-labs/stdlib/hash';
export { computeFeeJuiceMessageNullifier,
  computeFeeJuiceMessageNullifier as computeL1ToL2MessageNullifier,
  getNonNullifiedL1ToL2MessageWitness } from '@aztec-labs/stdlib/messaging';
export {createAztecNodeClient} from './aztec-node-client.mjs';
export {waitForNode, waitForTx} from '@aztec-labs/aztec.js/node';
export {retryUntil} from '@aztec-labs/foundation/retry';
export { PrivateFeePaymentMethod, PrivateMintAndPayFeePaymentMethod } from './private-fee-payment.mjs';
export { ProtocolContractAddress, ProtocolContractAddress as FeeJuiceAddressHolder } from '@aztec-labs/protocol-contracts';
import { ProtocolContractAddress } from '@aztec-labs/protocol-contracts';
export const FeeJuiceAddress = ProtocolContractAddress.FeeJuice;
export { FeeJuiceArtifact } from '@aztec-labs/protocol-contracts/fee-juice';
export { SchnorrAccountContract, SchnorrAccountContractArtifact,
  SchnorrInitializerlessAccountContract, SchnorrInitializerlessAccountContractArtifact,
  getSchnorrAccountContractAddress, getSchnorrInitializerlessAccountContractAddress } from '@aztec-labs/accounts/schnorr';
export { Barretenberg, BarretenbergSync } from '@aztec-foundation/bb.js';
export { poseidon2Hash, poseidon2HashBytes, poseidon2HashWithSeparator } from '@aztec-labs/foundation/crypto/poseidon';
export { sha256ToField } from '@aztec-labs/foundation/crypto/sha256';
export { initSync as initACVMSync } from '@aztec-foundation/noir-acvm_js';
export { initSync as initAbiSync } from '@aztec-foundation/noir-noirc_abi';

export { createJournalBackup } from './journal-backup.mjs';

export { extractApplicationNullifier } from './application-nullifier.mjs';

export { NoteStatus } from '@aztec-labs/stdlib/note';

export {validateDeploymentManifest,deploymentManifestConfig,verifyDeploymentInputs,preflightDeploymentNetwork,deploymentPolicyVersion} from './deployment-manifest.mjs';
export {verifyPortalRuntime} from './portal-runtime.mjs';
export {default as portalRuntimeMetadata} from './portal-runtime.json' with {type:'json'};

export {deriveBoardDepositSecret,recoverBoardDepositSecret} from './deposit-custody.mjs';

export {estimatePrivateFeeTransaction,sendPrivateFeeTransaction} from './private-fee-estimation.mjs';
export {consumePrivateFeeSimulationValidation} from './private-fee-validation.mjs';
export {provingEnabledForNode} from './proving-policy.mjs';

export {waitForL1ToL2MessageReady} from '@aztec-labs/aztec.js/messaging';

export {ordinaryPostFeeBudget,ordinaryPostFeeLimit} from './ordinary-post-fees.mjs';

export {isPrivateFeeCreditFailure} from './private-fee-client.mjs';

export {likeFeeBudget,likeFeeLimit} from './like-fees.mjs';
