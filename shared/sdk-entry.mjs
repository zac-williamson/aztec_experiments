// Legacy application consumers require the browser Buffer global.
import { Buffer } from 'node:buffer';
globalThis.Buffer ??= Buffer;

// Explicit browser/CLI compatibility surface for the pinned Aztec SDK.
// Build this source; do not recover exports by editing a generated bundle.
export { createPXE } from './private-pxe.mjs';
export { openPXEStore, getPXEStoreIdentity, PXE_DATA_SCHEMA_VERSION } from './sdk-store.mjs';
export { AztecSQLiteOPFSStore } from '@aztec/kv-store/sqlite-opfs';
export { BaseWallet } from '@aztec/wallet-sdk/base-wallet';
export { AccountManager, DeployAccountMethod } from '@aztec/aztec.js/wallet';
export { AztecAddress, CompleteAddress, EthAddress } from '@aztec/aztec.js/addresses';
export { Fr } from '@aztec/aztec.js/fields';
export { Contract, ContractFunctionInteraction, BatchCall, DeployMethod, NO_WAIT,
  getContractClassFromArtifact, getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
export { NO_FROM } from '@aztec/aztec.js/account';
export { preparePrivateFeePayment, derivePrivateFeeBridgeSecret, derivePrivateFeeAddress } from './private-fee-client.mjs';
export { fundPrivateFees, recoverPrivateFeeClaim } from './private-fee-funding.mjs';
export { FunctionCall, FunctionSelector, FunctionType, encodeArguments, loadContractArtifact } from '@aztec/aztec.js/abi';
export { Capsule, HashedValues, ExecutionPayload, TxExecutionRequest, TxHash } from '@aztec/aztec.js/tx';
export { TxContext } from '@aztec/stdlib/tx';
export { Gas, GasSettings } from '@aztec/stdlib/gas';
export { MerkleTreeId } from '@aztec/stdlib/trees';
export { computePartialAddress } from '@aztec/stdlib/contract';
export { deriveKeys, deriveKeysFromMasterSecretKeys, deriveMasterMessageSigningSecretKey,
  deriveMasterMessageSigningSecretKey as deriveSigningKey,
  deriveMasterMessageSigningSecretKey as deriveMasterMessageSigningSecretKeyAlias } from '@aztec/stdlib/keys';
export { computeSecretHash, deriveStorageSlotInMap, siloNullifier } from '@aztec/stdlib/hash';
export { computeFeeJuiceMessageNullifier,
  computeFeeJuiceMessageNullifier as computeL1ToL2MessageNullifier,
  getNonNullifiedL1ToL2MessageWitness } from '@aztec/stdlib/messaging';
export { createAztecNodeClient, waitForNode, waitForTx } from '@aztec/aztec.js/node';
export { PrivateFeePaymentMethod, PrivateMintAndPayFeePaymentMethod } from './private-fee-payment.mjs';
export { ProtocolContractAddress, ProtocolContractAddress as FeeJuiceAddressHolder } from '@aztec/protocol-contracts';
import { ProtocolContractAddress } from '@aztec/protocol-contracts';
export const FeeJuiceAddress = ProtocolContractAddress.FeeJuice;
export { FeeJuiceArtifact } from '@aztec/protocol-contracts/fee-juice';
export { SchnorrAccountContract, SchnorrAccountContractArtifact,
  SchnorrInitializerlessAccountContract, SchnorrInitializerlessAccountContractArtifact,
  getSchnorrAccountContractAddress, getSchnorrInitializerlessAccountContractAddress } from '@aztec/accounts/schnorr';
export { Barretenberg, BarretenbergSync } from '@aztec/bb.js';
export { poseidon2Hash, poseidon2HashBytes, poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
export { sha256ToField } from '@aztec/foundation/crypto/sha256';
export { initSync as initACVMSync } from '@aztec/noir-acvm_js';
export { initSync as initAbiSync } from '@aztec/noir-noirc_abi';
