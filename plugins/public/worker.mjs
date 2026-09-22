const log=console.log.bind(console);
console.log=(...parts)=>log(JSON.stringify({progress:parts.map(String).join(' ')}));
console.error=()=>log(JSON.stringify({progress:'SDK diagnostic omitted; inspect the phase evidence'}));
try{await import('./browser.mjs');}catch(error){console.log('FAILED',error.name,error.message);process.exitCode=1;}
process.exit(process.exitCode||0);
