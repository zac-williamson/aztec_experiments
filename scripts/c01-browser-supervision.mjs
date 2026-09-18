// Test-only ordering: a failed native coordinator cannot release a browser
// rendezvous. Stop owned work before awaiting that browser's completion.
export async function awaitCoordinatorAndBrowser({coordinator,getBrowser,stop}){
 let exit;
 try{exit=await coordinator;}catch(error){exit={errorClass:typeof error?.name==='string'?error.name:'Error'};}
 if(exit?.code!==0||exit.signal||exit.errorClass||exit.supervisionTimeout)stop('native-coordinator-failed');
 const browser=getBrowser();
 if(browser)await browser;
 return exit;
}
