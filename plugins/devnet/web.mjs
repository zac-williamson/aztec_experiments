import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EthCheatCodes,RollupCheatCodes} from '@aztec/ethereum/test';
import {EthAddress} from '@aztec/foundation/eth-address';
import {contentSecurityPolicy} from '../../deploy/hosting-config.mjs';

/** Official local test settlement prevents proof-disabled preview posts expiring. */
export async function retainPreviewCheckpoint({ethereumUrl,descriptor}){
 if(descriptor.scope.chainId!=='31337'||!['127.0.0.1','localhost'].includes(new URL(ethereumUrl).hostname))throw Error('Preview settlement requires the local devnet');
 const eth=new EthCheatCodes([ethereumUrl]);
 const rollup=new RollupCheatCodes(eth,{rollupAddress:EthAddress.fromString(descriptor.scope.rollupAddress)});
 await rollup.markAsProven();
 const {pending,proven}=await rollup.getTips();
 if(proven<pending)throw Error('Preview checkpoint was not retained');
 return Number(proven);
}

/** Serve the existing reader against the live local chains; no synthetic posts. */
export async function startBoardWeb({fixture,port=8788,privateFee=null,browserRpc,connectOrigins=[]}){
 const origin=`http://localhost:${port}`,root=path.resolve('apps/dist');
 const scope=fixture.descriptor.scope;
 const config={schemaVersion:1,network:{nodeUrl:origin+'/node',ethRpcUrl:origin+'/eth',chainId:scope.chainId,
   rollupVersion:scope.rollupVersion,rollupAddress:scope.rollupAddress},board:{contractAddress:scope.boardAddress,portalAddress:fixture.portalAddress},privateFee};
 const server=http.createServer(async(req,res)=>{
  try{
   res.setHeader('Cross-Origin-Opener-Policy','same-origin');
   res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
   const pathname=new URL(req.url,origin).pathname;
   if(req.method==='POST'&&(pathname==='/node'||pathname==='/eth')){
    if(browserRpc&&req.headers.origin!==origin)throw Error('Local browser origin required');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>10*1024*1024)throw Error('Request too large');}
    const rpc=JSON.parse(body),method=rpc.method;
    if(!browserRpc&&(typeof method!=='string'||!(pathname==='/node'?/^node_(get|find)/.test(method):['eth_chainId','eth_call','eth_blockNumber','eth_getBlockByNumber','eth_getLogs','eth_getCode'].includes(method))))throw Error('Read-only RPC required');
    const upstream=await fetch(browserRpc?(pathname==='/node'?browserRpc.nodeUrl:browserRpc.ethereumUrl):(pathname==='/node'?fixture.net.nodeUrl:fixture.net.rpcUrl),{method:'POST',headers:{'content-type':'application/json',...(browserRpc?{origin,'x-u01-test-token':browserRpc.token}:{})},body,signal:AbortSignal.timeout(30000)});
    res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(await upstream.text());return;
   }
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   if(pathname==='/board-reader-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;}
   const file=path.resolve(root,'.'+(pathname==='/'?'/feed.html':decodeURIComponent(pathname)));
   if(!file.startsWith(root+path.sep))throw Error('Invalid path');
   const body=await fs.readFile(file);
   if(file.endsWith('.html'))res.setHeader('Content-Security-Policy',contentSecurityPolicy(body.toString(),connectOrigins));
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':file.endsWith('.css')?'text/css':'application/octet-stream');
   res.setHeader('Cache-Control','no-store');res.end(body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:502);res.end('Local board request failed');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {url:origin+'/feed.html',close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
