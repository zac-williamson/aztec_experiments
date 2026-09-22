// The maintained supervisor owns this process and its complete descendant tree.
const log=console.log.bind(console);
console.log=(...items)=>log(JSON.stringify({progress:items.map(String).join(' ')}));
console.error=(...items)=>log(JSON.stringify({progress:'ERROR '+items.map(x=>x instanceof Error?x.name:String(x)).join(' ').replace(/0x[0-9a-fA-F]{64}/g,'[redacted]')}));
try{await import(process.argv.includes('--operations')?'./operator-test.mjs':'./browser.mjs');}catch(error){console.error(error.name, error.message);process.exitCode=1;}

// Every imported scenario has awaited its explicit cleanup and saved its result.
process.exit(process.exitCode||0);
