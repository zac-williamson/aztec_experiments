import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {getVersioningMiddleware} from '@aztec-labs/stdlib/versioning';
import {createCompactBlockNativeAdapter,COMPACT_BLOCK_NATIVE_ROUTE} from './compact-block-native.mjs';

export {COMPACT_NODE_STARTUP_SHA256,transformCompactNodeStartup} from './compact-node-transform.mjs';
const fail=()=>Error('Invalid compact node registration');
const own=(value,key)=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))throw fail();return d.value;};

/** The caller supplies the actual registered services and resolved startNode
 * config. Policy is never inferred from a request or an observed RPC identity.
 * Undefined tier keeps the additional endpoint off, including localNetwork. */
export function createCompactNodeMiddlewares(services,config,tier,versions,versioningOpts){
 if(tier===undefined)return [];
 try{
  if(!['proposed','checkpointed','proven','finalized'].includes(tier))throw fail();
  const tuple=own(services,'aztec');if(!Array.isArray(tuple)||tuple.length<2)throw fail();
  const node=own(tuple,'0'),chainId=own(config,'l1ChainId'),version=own(config,'rollupVersion'),proofsEnabled=own(config,'realProofs'),rollup=own(config,'rollupAddress');
  if(!Number.isSafeInteger(chainId)||chainId<=0||!Number.isSafeInteger(version)||version<=0||version>0xffffffff||typeof proofsEnabled!=='boolean'||!(rollup instanceof EthAddress))throw fail();
  const adapter=createCompactBlockNativeAdapter({node,expectedNetworkScope:{chainId,version,rollup:EthAddress.prototype.toString.call(rollup)},proofsEnabled,tier});
  // The official version middleware normally writes in finally, after next().
  // Raw stream responses finish before that point, so apply those same headers
  // before this one route writes. Ordinary RPC retains the original middleware.
  const versionHeaders=getVersioningMiddleware(Object.freeze({...versions}),Object.freeze({...versioningOpts}));
  return [async(ctx,next)=>{
   if(ctx.req.url!==COMPACT_BLOCK_NATIVE_ROUTE)return next();
   await versionHeaders(ctx,async()=>{});
   return adapter.middleware(ctx,next);
  }];
 }catch{throw fail();}
}
