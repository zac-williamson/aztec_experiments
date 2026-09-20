import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const ROUTES=Object.freeze({author:'apps/src/billboard/user/cli.mjs',deploy:'apps/src/billboard/deploy/cli.mjs',moderator:'censor-daemon/daemon.mjs',monitor:'deploy/operations-monitor.mjs','recover-wallet':'apps/src/billboard/user/recovery-cli.mjs'});
export function assertOperatorEnvironment(env=process.env){
 if(env.BILLBOARD_OPERATOR_PROFILE!=='1'||env.NODE_OPTIONS||env.NODE_PATH||env.OTEL_SDK_DISABLED!=='true'||env.OTEL_PROPAGATORS!=='none')throw Error('Use the supported shell operator launcher');
 for(const key of Object.keys(env))if(key.startsWith('OTEL_')&&!['OTEL_SDK_DISABLED','OTEL_PROPAGATORS'].includes(key))throw Error('Unsupported telemetry configuration');
}
export function operatorEnvironment(root,env=process.env){
 assertOperatorEnvironment(env);
 return {HOME:env.HOME,TMPDIR:env.TMPDIR||'/tmp',PATH:path.join(root,'runtime/bin')+':/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin',LANG:'C.UTF-8',OTEL_SDK_DISABLED:'true',OTEL_PROPAGATORS:'none',BILLBOARD_OPERATOR_PROFILE:'1'};
}
export function operatorCommand(root,argv){
 const [route,...args]=argv;
 if(!Object.hasOwn(ROUTES,route))throw Error('Unknown operator command');
 if(args.some(arg=>['--cli','--node','--node-binary','--require','--import','--eval','-e','-r'].includes(arg)||/^--(?:cli|node-binary|require|import|eval)=/.test(arg)))throw Error('Operator executable overrides are unsupported');
 return {entry:path.join(root,ROUTES[route]),args};
}
export function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 assertOperatorEnvironment();
 if(process.execArgv.length)throw Error('Unexpected Node flags');
 const pins=JSON.parse(fs.readFileSync(path.join(root,'toolchain.json'),'utf8'));
 if(process.versions.node!==pins.node||fs.realpathSync(process.execPath)!==fs.realpathSync(path.join(root,'runtime/bin/node')))throw Error('Incorrect packaged Node runtime');
 const {entry,args}=operatorCommand(root,process.argv.slice(2));
 process.execve(process.execPath,[process.execPath,entry,...args],operatorEnvironment(root));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{main();}catch(error){console.error(error.message);process.exitCode=64;}}
