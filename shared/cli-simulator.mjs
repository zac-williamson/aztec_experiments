import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// The browser bundle cannot resolve relative WASM URLs when evaluated by Node.
// Initialize its existing simulator modules from authenticated package assets.
export function initializeCliSimulator(sdk, root) {
  const directory=path.join(root,'.build','sdk');
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'sdk-manifest.json'),'utf8'));
  for(const [name,initialize] of [['noirc_abi_wasm_bg.wasm',sdk.initAbiSync],['acvm_js_bg.wasm',sdk.initACVMSync]]) {
    const fd=fs.openSync(path.join(directory,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    let bytes;
    try {
      if(!fs.fstatSync(fd).isFile())throw Error('CLI simulator asset is not a regular file');
      bytes=fs.readFileSync(fd);
    }finally{fs.closeSync(fd);}
    if(createHash('sha256').update(bytes).digest('hex')!==manifest.outputs[name])throw Error('CLI simulator asset digest mismatch');
    initialize({module:bytes});
  }
}
