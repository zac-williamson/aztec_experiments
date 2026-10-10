import {createAztecNodeClient as createSdkNodeClient} from '@aztec-labs/aztec.js/node';

// The public testnet endpoint supports at most three calls per JSON-RPC batch.
// V6 now batches concurrent PXE reads, so bound the SDK transport at creation.
export function createAztecNodeClient(url,options={}) {
  const maxBatchSize=options.maxBatchSize??3;
  if(!Number.isSafeInteger(maxBatchSize)||maxBatchSize<1||maxBatchSize>3)throw Error('Aztec RPC batch size must be between one and three');
  return createSdkNodeClient(url,{...options,maxBatchSize});
}
