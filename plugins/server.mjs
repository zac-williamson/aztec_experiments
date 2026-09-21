import http from 'node:http';
import {field} from './protocol.mjs';

/** HTTP exposes the protocol descriptor only. Executions originate from payments. */
export async function startPluginServer({descriptor,worker,payments,provider,startBlock=0,host='127.0.0.1',port=8787,finality='finalized',pollMs=2000,onError=()=>{}}) {
  if(finality!=='finalized'&&!(finality==='latest'&&descriptor.scope.chainId==='31337'))throw Error('Invalid L1 confirmation policy');
  let stopped=false,busy=false,cursor=startBlock;const waiting=new Map();
  const server=http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
    if(req.method==='GET'&&req.url==='/v1/descriptor'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(descriptor));}
    if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({protocol:descriptor.protocol,status:'ready'}));}
    res.writeHead(404);res.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  async function poll(){
    if(stopped||busy)return;busy=true;
    try{
      await payments.verify();const tip=await provider.getBlock(finality);if(!tip)return;
      if(cursor<=tip.number){const end=Math.min(cursor+999,tip.number);for(const payment of await payments.events(cursor,end)){try{field(payment.postId);}catch(error){onError(error);continue;}const key=payment.postId+payment.messageHash;if(!waiting.has(key)){if(waiting.size>=1024){onError(new Error('Pending request limit reached'));continue;}waiting.set(key,{...payment,expires:Date.now()+600000});}};cursor=end+1;}
      for(const [id,payment] of waiting){
        try{const result=await worker.handle(payment);if(result.state==='waiting-for-finality')continue;if(result.state!=='waiting-for-post')waiting.delete(id);else if(payment.expires<Date.now()){waiting.delete(id);onError(new Error('Paid post did not become available'));}}
        catch(error){waiting.delete(id);onError(error);}
      }
    }catch(error){onError(error);}finally{busy=false;}
  }
  let inFlight=Promise.resolve();
  const timer=setInterval(()=>{if(!busy)inFlight=poll();},pollMs);inFlight=poll();await inFlight;
  return {address:server.address(),async close(){stopped=true;clearInterval(timer);await inFlight;const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed;}};
}
