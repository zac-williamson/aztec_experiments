import {veniceClient,veniceModel} from './venice.mjs';

const command=process.argv[2]??'status';
if(!['address','status','top-up','smoke'].includes(command))throw Error('Use address, status, top-up, or smoke');
const client=veniceClient({privateKey:process.env.VENICE_WALLET_PRIVATE_KEY});
if(command==='address')console.log(client.address);
if(command==='status')console.log(JSON.stringify({address:client.address,...await client.balance()},null,2));
if(command==='top-up')console.log(JSON.stringify(await client.topUp(Number(process.env.VENICE_MAX_TOP_UP_USD||5)),null,2));
if(command==='smoke'){
  const model=veniceModel({client,model:process.env.VENICE_MODEL||undefined,
    autoTopUp:process.env.VENICE_AUTO_TOP_UP==='true',maxTopUpUsd:Number(process.env.VENICE_MAX_TOP_UP_USD||5)});
  const result=await model.complete({messages:[{role:'user',content:'Reply with: Venice connection works.'}],tools:[],maxTokens:64});
  console.log(JSON.stringify({reply:result.message.content,allowanceCostUsd:result.cost},null,2));
}
