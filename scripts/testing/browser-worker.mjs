import fs from 'node:fs/promises';
import path from 'node:path';
import {describeFailure} from './supervisor.mjs';
export async function readControl() {
  let text='';
  for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>65536)throw Error('Test control too large');}
  return JSON.parse(text);
}
export async function runBrowser(directory,control) {
  let result;
  try {
    if(control?.browserMode==='rolling-composer'){
      const {runRollingComposerBrowser}=await import('./rolling-composer-browser.mjs');
      result=await runRollingComposerBrowser({...control,directory,onStage:stage=>console.log(JSON.stringify({stage}))});
    }else if(control?.browserMode==='rolling-preferences'){
      const {runRollingPreferenceBrowser}=await import('./rolling-preference-browser.mjs');
      result=await runRollingPreferenceBrowser({...control,directory,onStage:stage=>console.log(JSON.stringify({stage}))});
    }else if(control?.browserMode==='rolling-notifications'){
      const {runRollingNotificationBrowser}=await import('./rolling-notification-browser.mjs');
      result=await runRollingNotificationBrowser({...control,directory,onStage:stage=>console.log(JSON.stringify({stage}))});
    }else{
    const {validateBrowserWorkerControl,driveT04BrowserJourney}=await import('../t04-browser-journey.mjs');
    const {driveT04BrowserPerformance}=await import('../t04-browser-performance.mjs');
    const {driveT04BrowserFunding}=await import('../t04-browser-funding.mjs');
    const {runU01BrowserPost}=await import('../u01-browser-post.mjs');
    validateBrowserWorkerControl(control,{directory});
    result=await runU01BrowserPost({...control,directory,
      journeyDriver:control.browserMode==='performance'?driveT04BrowserPerformance:control.browserMode==='lifecycle'?driveT04BrowserJourney:control.browserMode==='funding'?driveT04BrowserFunding:undefined,
      diagnostic:process.env.BOARD_TEST_DIAGNOSTIC==='1',observeProofStages:control.browserMode==='post',
      onStage:stage=>console.log(JSON.stringify({stage}))});
    }
  }catch(error){result={passed:false,failure:describeFailure(error)};}
  if(['rolling-composer','rolling-preferences','rolling-notifications'].includes(control?.browserMode)){
    const {writeComposerResultAndAwaitAck}=await import('./rolling-composer-fixture.mjs');
    await writeComposerResultAndAwaitAck({directory,result});
  }else await fs.writeFile(path.join(directory,'browser-result.json'),JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
  process.exitCode=result.passed?0:1;
}
