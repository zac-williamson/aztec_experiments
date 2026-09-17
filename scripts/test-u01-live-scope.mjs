import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectPublicFeed} from '../shared/public-feed-connection.mjs';
import fs from 'node:fs';
const metadata=JSON.parse(fs.readFileSync(new URL('../.build/public-feed/metadata.json',import.meta.url)));
const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const config={network:{nodeUrl:'https://node.example/',ethRpcUrl:'https://eth.example/',chainId:'31337',rollupVersion:'5',rollupAddress:address(1)},board:{portalAddress:address(2),contractAddress:field(3)}};
async function connect(change={}){
 const fetchImpl=async(url,options)=>{
  assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
  const q=JSON.parse(options.body);let result;
  if(q.method==='eth_chainId')result=change.chain??'0x7a69';
  else if(q.method==='eth_call'){
   const name=Object.keys(metadata.portalSelectors).find(k=>metadata.portalSelectors[k]===q.params[0].data);
   result=field(({L2_CONTRACT:change.board??3,ROLLUP:1,VERSION:5,L1_CHAIN_ID:31337})[name]);
  }else if(q.method==='node_getNodeInfo')result={l1ChainId:31337,rollupVersion:5,l1ContractAddresses:{rollupAddress:address(1)}};
  else if(q.method==='node_getContract')result={originalContractClassId:metadata.classId,currentContractClassId:change.classId??metadata.classId};
  else if(q.method==='node_getBlockData')result={header:{globalVariables:{blockNumber:4}},blockHash:field(99)};
  else if(q.method==='node_getPublicStorageAt'){
   const slot=BigInt(q.params[2]),base=BigInt(metadata.storage.config);
   result=field(({[metadata.storage.portal]:change.reversePortal??2,[base]:31337,[base+1n]:1,[base+2n]:5,[base+7n]:100})[slot]);
  }else throw Error('Unexpected request: '+q.method);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}),{headers:{'content-type':'application/json'}});
 };
 return connectPublicFeed({nodeUrl:config.network.nodeUrl,ethereumUrl:config.network.ethRpcUrl,portalAddress:config.board.portalAddress,expectedConfig:config,metadata,storage:{get:async()=>null,set:async()=>{}},fetchImpl});
}
test('actual connection verifier accepts matching imported network/board/class/reverse scope',async()=>{const r=await connect();assert.equal(r.scope.boardAddress,config.board.contractAddress);});
for(const [name,change,error] of [['wrong Ethereum chain',{chain:'0x1'},/Ethereum endpoint/],['different board at portal',{board:4},/Live board does not match/],['upgraded board class',{classId:field(77)},/Board contract does not match/],['wrong reverse portal',{reversePortal:8},/Board and portal configuration do not agree/]])test(name+' rejects before wallet work',async()=>{await assert.rejects(connect(change),error);});
