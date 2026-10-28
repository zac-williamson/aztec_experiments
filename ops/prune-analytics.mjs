import {lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAnalyticsStore} from './analytics.mjs';
export async function pruneAnalytics(filename,{now=Date.now}={}){
 if(await realpath(filename)!==resolve(filename)||!(await lstat(filename)).isFile())throw Error('Analytics database unavailable');
 const store=openAnalyticsStore({filename,now});try{return store.prune();}finally{store.close();}
}
const invokedFile=process.argv[1]&&await realpath(process.argv[1]).catch(()=>null);
if(invokedFile&&import.meta.url===pathToFileURL(invokedFile).href){
 try{if(process.argv.length!==3)throw Error();process.stdout.write(JSON.stringify(await pruneAnalytics(process.argv[2]))+'\n');}
 catch{process.stderr.write('Analytics retention maintenance failed\n');process.exitCode=1;}
}
