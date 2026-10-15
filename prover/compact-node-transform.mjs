// Pure startup rewriting only. Preloading this module must not import the SDK
// or the runtime middleware before the existing source-verifying hook is ready.
import {createHash} from 'node:crypto';
export const COMPACT_NODE_STARTUP_PATH='/usr/src/yarn-project/aztec/dest/cli/aztec_start_action.js';
export const COMPACT_NODE_STARTUP_SHA256='33fbbf4d8a1b7c1b148d30fb283e61e25076b07dc2f99ba7a64bb6698d9e95e4';
const call='                getVersioningMiddleware(versions, versioningOpts)';
const anchor=call+'\n            ],';
const runtimeUrl=new URL('./compact-node-registration.mjs',import.meta.url).href;
const fail=()=>Error('Invalid compact node registration');

/** One fixed insertion, always validated against the original CLI bytes. This
 * is not a caller-supplied patch API. Both startup consumers use this descriptor. */
export function compactNodeStartupInsertion(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==COMPACT_NODE_STARTUP_SHA256||source.split(anchor).length!==2)throw fail();
 return Object.freeze({
  prefix:`import {createCompactNodeMiddlewares as __rollingCompactMiddlewares} from ${JSON.stringify(runtimeUrl)};\n`,
  at:source.indexOf(anchor)+call.length,
  text:',\n                ...__rollingCompactMiddlewares(services, config, process.env.ROLLING_COMPACT_TIER, versions, versioningOpts)',
 });
}
export function transformCompactNodeStartup(source){
 const insertion=compactNodeStartupInsertion(source);
 return insertion.prefix+source.slice(0,insertion.at)+insertion.text+source.slice(insertion.at);
}
