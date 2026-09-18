// Caller-independent public reads must not send the wallet owner as RPC origin.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {NO_FROM} from '@aztec/aztec.js/account';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {FunctionCall,FunctionSelector,FunctionType} from '@aztec/stdlib/abi';
import {GasSettings} from '@aztec/stdlib/gas';
import {BlockHeader} from '@aztec/stdlib/tx';
import {BaseWallet} from '@aztec/wallet-sdk/base-wallet';
const source=await fs.readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const context=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});vm.runInContext(source,context);
const views=['get_post_id','get_post_exists','get_moderation_policy_snapshot','get_post_policy_version','get_base_cooldown','get_min_deposit','get_max_save_up','get_censor','get_post_count','get_k_multiplier','get_censor_window','get_post','get_post_length','is_post_flagged','get_censor_response','get_censor_response_length','get_post_flagged_by','get_post_time','get_post_flag_deadline'];
test('every caller-independent public getter supplies supported SDK NO_FROM',()=>{
 for(const name of views){
  const calls=[...source.matchAll(new RegExp('\\.methods\\.'+name+'\\([^\\n]*?\\)\\.simulate\\((\\{[^}]*\\})\\)','g'))];
  assert(calls.length>0,`Missing view ${name}`);
  for(const call of calls){const options=vm.runInNewContext('('+call[1]+')',{a:{NO_FROM},address:'PRIVATE_OWNER',censorAddress:'PRIVATE_MODERATOR'});assert.equal(options.from,NO_FROM,name);}
 }
});
test('actual public post lookup is neutral while private screening keeps owner and chain',async()=>{
 const seen=[],owner=new AztecAddress(new Fr(101)),chain=new Fr(202),id=new Fr(303);
 const contract={methods:{get_post_id:order=>({simulate:async opts=>{seen.push(['public',opts.from,order]);return{result:id};}}),get_post_exists:value=>({simulate:async opts=>{seen.push(['public',opts.from,value]);return{result:true};}}),get_screen_hints:(who,which)=>({simulate:async opts=>{seen.push(['private',opts.from,who,which]);return{result:[null,null]};}})}};
 await context.BillboardPostCodec.resolvePostId({Fr,NO_FROM},contract,owner,{postIndex:0});
 await context.BillboardScreeningHistory.readScreeningHints(contract,owner,chain);
 assert(seen.filter(row=>row[0]==='public').length>0);
 for(const row of seen.filter(row=>row[0]==='public'))assert.equal(row[1],NO_FROM);
 assert.deepEqual(seen.at(-1),['private',owner,owner,chain]);
});
test('installed SDK maps NO_FROM public-static simulation to zero sender and fee payer',async()=>{
 let captured;
 const wallet={completeFeeOptions:async()=>({gasSettings:GasSettings.empty()}),getChainInfo:async()=>({chainId:new Fr(31337),version:new Fr(1)}),pxe:{getSyncedBlockHeader:async()=>BlockHeader.empty()},aztecNode:{simulatePublicCalls:async tx=>{captured=tx;return{debugLogs:[],publicReturnValues:[]};}},getContractName:async()=>'',simulateViaEntrypoint:async()=>{throw Error('Public view must not use account entrypoint');}};
 const call=FunctionCall.from({name:'get_post_count',to:new AztecAddress(new Fr(303)),selector:FunctionSelector.fromField(new Fr(7)),type:FunctionType.PUBLIC,hideMsgSender:false,isStatic:true,args:[],returnTypes:[]});
 await BaseWallet.prototype.simulateTx.call(wallet,{calls:[call],authWitnesses:[],capsules:[],extraHashedArgs:[]},{from:NO_FROM});
 assert(captured.data.feePayer.isZero());
 const calls=captured.getPublicCallRequestsWithCalldata();assert.equal(calls.length,1);assert(calls[0].request.msgSender.isZero());assert(calls[0].request.contractAddress.equals(call.to));
});
