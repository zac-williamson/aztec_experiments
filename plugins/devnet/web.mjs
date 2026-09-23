import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
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
export async function startBoardWeb({fixture,port=8788,privateFee=null,browserRpc,connectOrigins=[],publicConfig}){
 const origin=`http://localhost:${port}`,root=path.resolve('apps/dist');
 const scope=fixture.descriptor.scope;
 const config=publicConfig??{schemaVersion:1,network:{nodeUrl:origin+'/node',ethRpcUrl:origin+'/eth',chainId:scope.chainId,
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
   if(pathname==='/wallet-setup.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Test wallet network setup</title>');return;}
   if(pathname==='/board-reader-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;}
   const file=path.resolve(root,'.'+(pathname==='/'?'/feed.html':decodeURIComponent(pathname)));
   if(!file.startsWith(root+path.sep))throw Error('Invalid path');
   const stat=await fs.stat(file);if(!stat.isFile())throw Object.assign(Error('Not a file'),{code:'ENOENT'});
   if(file.endsWith('.html'))res.setHeader('Content-Security-Policy',contentSecurityPolicy(await fs.readFile(file,'utf8'),connectOrigins));
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':file.endsWith('.css')?'text/css':'application/octet-stream');
   res.setHeader('Cache-Control','no-store');res.setHeader('Accept-Ranges','bytes');
   let start=0,end=stat.size-1;
   if(req.headers.range){
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if(!range){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});res.end();return;}
    start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});res.end();return;}
    res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);
   }
   res.setHeader('Content-Length',end-start+1);
   // CRS files are large; honor the browser's byte ranges without whole-file buffers.
   if(stat.size===0){res.end();return;}
   await pipeline(createReadStream(file,{start,end}),res);
  }catch(error){if(res.destroyed)return;if(res.headersSent){res.destroy();return;}res.writeHead(error.code==='ENOENT'?404:502);res.end('Local board request failed');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {url:origin+'/feed.html',close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
