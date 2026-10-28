// Fixed read-only public-index query. Only aggregate counts leave this process.
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readCommunitySummary} from './community.mjs';
export async function exportCommunity(configFile,{now=Date.now}={}){
 if(configFile!=='/etc/rolling-app/public.json')throw Error('Public configuration required');
 const config=JSON.parse(await readFile(configFile,'utf8'));
 if(typeof config.cacheDirectory!=='string'||!config.cacheDirectory.startsWith('/var/lib/private/rolling-application/index/')||path.resolve(config.cacheDirectory)!==config.cacheDirectory)throw Error('Public index unavailable');
 const filename=path.join(config.cacheDirectory,'rolling-public-v3.sqlite'),observedAt=new Date(now()).toISOString();
 return Object.fromEntries([7,30].map(days=>[String(days),{...readCommunitySummary({filename,days,now}),observedAt}]));
}
const invoked=process.argv[1]&&await realpath(process.argv[1]).catch(()=>null);
if(invoked&&pathToFileURL(invoked).href===import.meta.url){try{process.stdout.write(JSON.stringify(await exportCommunity(process.argv[2]))+'\n');}catch{process.stderr.write('Public summary unavailable\n');process.exitCode=1;}}
