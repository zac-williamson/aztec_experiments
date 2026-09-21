import fs from 'node:fs';
import path from 'node:path';
import {contentSecurityPolicy} from '../hosting-config.mjs';
import {ROOT,assertNodeVersion} from '../../scripts/toolchain.mjs';

assertNodeVersion();
const [output,aztecOrigin,ethereumOrigin]=process.argv.slice(2);
if(!output||!aztecOrigin||!ethereumOrigin)throw Error('Usage: build-template.mjs OUTPUT AZTEC_ORIGIN ETHEREUM_ORIGIN');
const template=JSON.parse(fs.readFileSync(new URL('./testnet-stack.json',import.meta.url)));
const policies={};
for(const page of ['boards.html','feed.html','user.html','censor.html','deploy.html','fee-juice.html']) {
  policies['/'+page]=contentSecurityPolicy(fs.readFileSync(path.join(ROOT,'apps/dist',page),'utf8'),[aztecOrigin,ethereumOrigin]);
}
policies['/']=policies['/feed.html'];
const code='var policies='+JSON.stringify(policies)+';function handler(event){var response=event.response;var policy=policies[event.request.uri];if(policy){response.headers["content-security-policy"]={value:policy};}return response;}';
if(Buffer.byteLength(code)>10000)throw Error('Generated page policy exceeds CloudFront function size limit');
template.Resources.PagePolicy.Properties.FunctionCode=code;
fs.writeFileSync(output,JSON.stringify(template,null,2)+'\n');
console.log('Prepared template with '+Buffer.byteLength(code)+' bytes of page policies.');
