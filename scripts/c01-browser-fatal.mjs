// Diagnostic-only streaming classifier. Never retain or return raw stderr.
export function createBrowserFatalClassifier(){
 let tail='',category=null;
 const marker=/(?:^|\n)FATAL ERROR: (?:Reached heap limit Allocation failed - JavaScript heap out of memory|Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory)(?:\r?\n|$)/;
 return {
  push(bytes){
   const text=typeof bytes==='string'?bytes:bytes.toString('utf8');
   for(let offset=0;offset<text.length;offset+=2048){
    tail=(tail+text.slice(offset,offset+2048)).slice(-4096);
    if(marker.test(tail))category='NODE_HEAP_OUT_OF_MEMORY';
   }
  },
  snapshot(){return {category,retainedCharacters:tail.length};},
 };
}
