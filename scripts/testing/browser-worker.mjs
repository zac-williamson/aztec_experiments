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
    const {validateBrowserWorkerControl,driveT04BrowserJourney}=await import('../t04-browser-journey.mjs');
    const {runU01BrowserPost}=await import('../u01-browser-post.mjs');
    validateBrowserWorkerControl(control,{directory});
    result=await runU01BrowserPost({...control,directory,
      journeyDriver:control.browserJourney?driveT04BrowserJourney:undefined,
      diagnostic:false,observeProofStages:!control.browserJourney&&!control.browserRecovery,
      onStage:stage=>console.log(JSON.stringify({stage}))});
  }catch(error){result={passed:false,failure:describeFailure(error)};}
  await fs.writeFile(path.join(directory,'browser-result.json'),JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
  process.exitCode=result.passed?0:1;
}
