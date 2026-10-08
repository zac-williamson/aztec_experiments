// Real Chrome WebAuthn PRF ceremony with a disposable virtual authenticator.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {chromium} from 'playwright';
const source=await fs.readFile(new URL('../shared/passkey-wallet.js',import.meta.url),'utf8');
const server=http.createServer((_req,res)=>res.end('<script>'+source+'</script>'));
let browser;
if(process.env.U01_BOUNDED_BROWSER!=='true')throw Error('Run through run-bounded-browser-check.mjs.');
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();page.setDefaultTimeout(10000);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('WebAuthn.enable');
 await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,hasPrf:true,automaticPresenceSimulation:true,isUserVerified:true}});
 const url='http://localhost:'+server.address().port;
 await page.goto(url);
 const created=await page.evaluate(()=>BillboardPasskey.ceremony('0x'+'12'.repeat(20),{create:true}));
 await page.reload();
 const restored=await page.evaluate(id=>BillboardPasskey.ceremony('0x'+'12'.repeat(20),{credentialId:id}),created.credentialId);
 assert.deepEqual(restored,created);
 const discovered=await page.evaluate(()=>BillboardPasskey.ceremony('0x'+'12'.repeat(20)));
 assert.deepEqual(discovered,created);
 const second=await page.evaluate(()=>BillboardPasskey.ceremony('0x'+'12'.repeat(20),{create:true}));
 assert.notEqual(second.credentialId,created.credentialId);
 const firstAgain=await page.evaluate(id=>BillboardPasskey.ceremony('0x'+'12'.repeat(20),{credentialId:id}),created.credentialId);
 assert.deepEqual(firstAgain,created);
 console.log(JSON.stringify({passed:true,checks:['creation','reload','discovery','old-credential-preserved'],authenticator:'Chrome virtual PRF'}));
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
