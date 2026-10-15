// TEST ONLY: native Node adapter for the pinned browser SDK's attribute-less
// JSON imports. No source/byte transformation, alternative provider, or network.
// Node24 API: https://nodejs.org/docs/latest-v24.x/api/module.html#moduleregisterhooksoptions
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pins} from '../toolchain.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>Object.assign(Error('Pinned native artifact adapter configuration mismatch'),{code:'ROLLING_NATIVE_ARTIFACTS_CONFIG'});
const VERSION='6.0.0-rc.3';
// Exact installed official loader maps. Updating pins requires source review,
// complete map enumeration and all-provider byte equality tests again.
const LOADERS=Object.freeze({
  "protocol-contracts/dest/fee-juice/lazy.js": "49ec7e07e98e608aa359af6ded3a02543637ef348af610d563049cd59b85c665",
  "protocol-contracts/dest/class-registry/lazy.js": "256f14b4451f3f7de9d55512409ce87c40ca41ae490afc234a4a2fc7ca47fb15",
  "protocol-contracts/dest/instance-registry/lazy.js": "fef787ccb08fc7bf02c73c9eb9e5b26fde1a7cdf401aaca8e4580ee0433f3462",
  "standard-contracts/dest/auth-registry/lazy.js": "2298afe1df16bc4a9e1153d6af50819662d123916d012190b0dd6077bb25ffb7",
  "standard-contracts/dest/handshake-registry/lazy.js": "4ad7a29776282399da32556c3f85425d9fc91c48276bccb64963c98412899314",
  "standard-contracts/dest/multi-call-entrypoint/lazy.js": "aca9517c0a334263873f976c4bd55069259701fa30982ec9e65e96549a81f00d",
  "noir-protocol-circuits-types/dest/client_artifacts_helper.js": "7dd23be379bec54bdd7ba4de79b31f898457e9c7a88227ec2d559d081a13decd"
});
const ARTIFACTS=Object.freeze({
  "noir-protocol-circuits-types/artifacts/hiding_kernel_to_public.json": "61551fe01b7bcda7762735c7425ef037559d0e64919e176a4ddfffe947af55bf",
  "noir-protocol-circuits-types/artifacts/hiding_kernel_to_rollup.json": "ccbc13d7eaddbae7b84689dd475126ca58fc64942dc1004b7b80dc3e9b2c4c97",
  "noir-protocol-circuits-types/artifacts/private_kernel_init.json": "0cb2ccc59e96024e91afeebc9d4958d376e232f6d9a22fa992d10f78a08fd740",
  "noir-protocol-circuits-types/artifacts/private_kernel_init_2.json": "56f2c9966da1f4299c7100a0c25e4594cdf563c5ccf44522c1b45987f82b78d5",
  "noir-protocol-circuits-types/artifacts/private_kernel_init_3.json": "1e6f993c32cd31e6ddb3e554e315b30ca314c702f324d438e736df783ef6b59a",
  "noir-protocol-circuits-types/artifacts/private_kernel_init_4.json": "ee1daebc489914181d4e5d8ba3f1ed1e7a90bb03123d5ff840d7c4f2992e3148",
  "noir-protocol-circuits-types/artifacts/private_kernel_init_5.json": "2d90040ac9f029a42aec99994ba7fbffdf53595beecd6b31e0828e15abeaba1d",
  "noir-protocol-circuits-types/artifacts/private_kernel_init_simulated.json": "3c1fb858435e23684c6c097741cebb56f0f922c0c6c24521d30884f05201fcd7",
  "noir-protocol-circuits-types/artifacts/private_kernel_inner.json": "a9dfd35d52a5f0f890badd6bb45cd3d69308b174ba8f77c3168d53fa8a9cec44",
  "noir-protocol-circuits-types/artifacts/private_kernel_inner_2.json": "2ae67041c40ec5f720ae271ab87cc60bfd03ec14580885178e58a12f28806cc0",
  "noir-protocol-circuits-types/artifacts/private_kernel_inner_3.json": "29af9f84f2d810cac9137408642a4ff4d04e584d8b8dde8bbd0e47b734e04e3b",
  "noir-protocol-circuits-types/artifacts/private_kernel_inner_4.json": "47063253eff5256abe382c344760e129a3462446c48b42259cad1e5144dd906a",
  "noir-protocol-circuits-types/artifacts/private_kernel_inner_5.json": "284a65478ae857470f0d4674526265fd5d5d96b3d2a7eb4b804bcd45e88afc1f",
  "noir-protocol-circuits-types/artifacts/private_kernel_inner_simulated.json": "e815daa2e1b5f75a35accfa9cdf40c880dc4bc10b39a36c5da537df91ca0ba27",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_0_0_0_0_0_64_0_0_0.json": "76ce9a97de7adc5ca4a5557b45d0487a24f0f1dcda4b664be9f4de28ad20596d",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_0_0_0_0_64_0_0_0_0.json": "d3df4c7798844a33a4ab620a0b66eb3ee19687d46875fabd30e7a070d1d5c64c",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_0_0_0_64_0_0_0_0_0.json": "cfb444b000f8374a22ff73d45182581226df18ddaf549622bbfef622d29a4234",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_0_0_64_0_0_0_0_0_0.json": "3cf6707d24de2b08632380cafc16abab44d4c12e62bf80bed3bafd40966a78d9",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_0_64_0_0_0_0_0_0_0.json": "f29de42e5261eccd39d197d9795407150f809c51c8f8fe06187dacabf35761aa",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_32_32_32_32_16_16_0_0_0.json": "62f2f6c44e6dde0c9e6d16daaf5540976b6a1d1f9ec47a97f64cbdc868de700c",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_4_4_4_4_4_4_0_0_0.json": "0d0d247f4b0df562a3921ef1710b20b54fe54ad6ff6b9c4a243d5742026e2d34",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_64_0_0_0_0_0_0_0_0.json": "897cb961f0ca64d40a7c0ef43468eaa5390226677a083d5501645156866d54de",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_0_0_0_0_0_64_0_0_0.json": "427cfa7e899cddc9d1cd56b886b4af2f291871769ca5664e24364d79743ab1e9",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_0_0_0_0_64_0_0_0_0.json": "3115f631b91223a36ec5a7556068ea28eb971cd7e298223e709ee96eccd81968",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_0_0_0_64_0_0_0_0_0.json": "5d1ea5db498a10bc7b835c909cd97ea86a3ce89749e9e1718204e4d0d47b315a",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_0_0_64_0_0_0_0_0_0.json": "6fa3a3b4b7d46599b006666b98df91332894bfc9b101ef74c3b639c2ef6e1b27",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_0_64_0_0_0_0_0_0_0.json": "7481f5b644adcd32246b45c653d903d3f580d820f593acdbb57b4f91cf0633a7",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_32_32_32_32_16_16_0_0_0.json": "28161b9c9dc6be1c08720864e84d4bbc3287f2476248c0821523a52e6e5f87b3",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_4_4_4_4_4_4_0_0_0.json": "cfd8463b8b03f920bc431e4ff0cd6038208ecd85916b89e172b552139b6e793a",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_simulated_64_0_0_0_0_0_0_0_0.json": "0e410dd1d7e9c45b3e8786c971590926ea5599a3a21d3c16445f82d5415a10f8",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail.json": "cd94cf1741438513fa311158e09cd5e3a2796775cdd4be766d29e20de22f3426",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_0_8_0_8_4_0_4_16_8.json": "0641d7d54b171e77840736920598df3b17c4f85beca14f756db4ebc1e5dd36db",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_16_16_16_16_16_16_16_16_16.json": "ad9a73a0afef04b3f4097cb854065ee2d97635477dcc4a919a983fd42d081f6a",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_32_32_32_32_32_32_32_32_32.json": "15d237368e977502ba1a68c3d21819300dee0e2d096817f6788af2017e34f6c8",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_4_4_4_4_4_4_4_4_4.json": "0647352d56873e9c8bcb8faca0ade8ce5c8bccf47aebbb5c2baa96919e093299",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_8_8_8_8_8_8_8_8_8.json": "e11777da4426c4c8d31d0dd4bff4078ca39fff32934f20c28e952fd6f3ce69c6",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_simulated.json": "4a02cb17153c697fb8d16d3f019ddef7de0a22d8b1a86387e3e5f3887838bf43",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_simulated_0_8_0_8_4_0_4_16_8.json": "e4f535d2808223182335588ad7fe20afde4b8b03d12e64c29bc3a9f391a0f59f",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_simulated_16_16_16_16_16_16_16_16_16.json": "53e324d9090f46717aada24318031a503ec1726997ad131929473e059fa342d1",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_simulated_32_32_32_32_32_32_32_32_32.json": "b1675bceda7d6dcda81ed8dd9a8873c8b16482cb46e422c6d196086708b2ddf1",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_simulated_4_4_4_4_4_4_4_4_4.json": "7ad5de154191403efd7640c5384e081f7500d6c4cca411b6e9c93d6a1b9e7154",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_simulated_8_8_8_8_8_8_8_8_8.json": "9bf79419144f15b6f0ac51edcc8fe5d7a99ff2734828fe995f1b496cc1d3601f",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public.json": "ea2cbc9ee149e28bc0b3600561bd5db40547e13493350c7da0e073fcd67c47f6",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_0_8_0_8_4_0_4_16_8.json": "f4dd892683fa6c8b09e05a3c86714d994c40d0bb1a617a9c9b4d5cb7d40fc4f4",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_16_16_16_16_16_16_16_16_16.json": "995c3e343a9d186b5b0b144d32094576d8be881697e17cbd43228b939559ceea",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_32_32_32_32_32_32_32_32_32.json": "792d517ecd035fa008727ff956d6b609b2598f79b27dd686435546a14e3b02c6",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_4_4_4_4_4_4_4_4_4.json": "9d70457810e5e2c8fd5bd77f18e9e59746c0e63a3909afd1256cd2c8516c7bcd",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_8_8_8_8_8_8_8_8_8.json": "19210ed55f1eee1067d0df9e339f00058663dc25b887ccf764a8bbbe62693e4e",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_simulated.json": "7e3952af12d6d3ece57e0ae8f19fc0de7ab58d08f9bfcf83a00520d4975c3dab",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_simulated_0_8_0_8_4_0_4_16_8.json": "796c1f1c3f7da0df0ceae6b3a9b71a9fb6bf533b719dd2cce77894bc33cd1680",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_simulated_16_16_16_16_16_16_16_16_16.json": "17aa80f7d9f638bf59252ff84cb39e21c7f8b0387840c3a5c2bd9683ec116b9f",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_simulated_32_32_32_32_32_32_32_32_32.json": "a07283b143e5078907527baaee68deec3c7fc1aa07d19d74d1cf1cb9749c84bd",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_simulated_4_4_4_4_4_4_4_4_4.json": "b51c4643b73c94666f065b3965d06513d2555ac1dba59bf0c1385a4b405820e6",
  "noir-protocol-circuits-types/artifacts/private_kernel_reset_tail_to_public_simulated_8_8_8_8_8_8_8_8_8.json": "34b4a4c1911f8f327404f5dfa72f2b18880b30cf419f901b1d19d019485b9718",
  "protocol-contracts/artifacts/ContractClassRegistry.json": "6fcc5f63c8a209cca50a441f5609470762a6f4a1f39c6a664b8a57ab783820cf",
  "protocol-contracts/artifacts/ContractInstanceRegistry.json": "8f59f37cf688bb7669a696f0643c643d62dfcbb69a7db74089753036764dc51f",
  "protocol-contracts/artifacts/FeeJuice.json": "20a32ea9cfe9be352df89841835a2c6a5f4a774a5272f442e401ddc6199ed44b",
  "standard-contracts/artifacts/AuthRegistry.json": "f560c62285dd1b7ab71275d801c23a7d90c26a8722eafd70979c49ec95b089fb",
  "standard-contracts/artifacts/HandshakeRegistry.json": "6e480cccad4d567d311359e3690a516ae03817fcac035830c810bbd41077d53b",
  "standard-contracts/artifacts/MultiCallEntrypoint.json": "aa5dc06a71f0374484e9a9177931d1157a6d763728991ad78b6d103b5379cdb2"
});

const ROOTS=Object.freeze({
  'protocol-contracts':path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@aztec-labs/protocol-contracts/providers/lazy'))),'../..'),
  'standard-contracts':path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@aztec-labs/standard-contracts/auth-registry/lazy'))),'../..'),
  'noir-protocol-circuits-types':path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@aztec-labs/noir-protocol-circuits-types/client/lazy'))),'../../..'),
});
const local=name=>{const [pkg,...parts]=name.split('/');assert(ROOTS[pkg]);return path.join(ROOTS[pkg],...parts);};
let active=false;
export function installRollingNativeArtifacts() {
  if(active||typeof window!=='undefined'||process.versions.node!==pins.node||!pins.node.startsWith('24.'))throw fail();
  const inputs={},urls=new Map(),actualArtifacts=new Set();
  // Check package identity, exact map contents, path confinement and artifact bytes
  // BEFORE registering a hook. A package update cannot widen the adaptation.
  for(const [pkg,root] of Object.entries(ROOTS)){
    const bytes=fs.readFileSync(path.join(root,'package.json')),metadata=JSON.parse(bytes);
    if(metadata.name!=='@aztec-labs/'+pkg||metadata.version!==VERSION)throw fail();
    inputs['node_modules/@aztec-labs/'+pkg+'/package.json']=digest(bytes);
  }
  for(const [name,expected] of Object.entries(LOADERS)){
    const filename=local(name),bytes=fs.readFileSync(filename);
    if(digest(bytes)!==expected)throw fail();inputs['node_modules/@aztec-labs/'+name]=expected;
    const pkg=name.split('/')[0],root=ROOTS[pkg];
    const targets=[...bytes.toString('utf8').matchAll(/import\((['"])([^'"]+\.json)\1\)/g)];
    if(targets.length===0)throw fail();
    for(const [, ,target] of targets){
      if(!/^\.\.\/(?:\.\.\/)?artifacts\/[A-Za-z0-9_]+\.json$/.test(target))throw fail();
      const filename=path.resolve(path.dirname(local(name)),target);
      const relative=pkg+'/'+path.relative(root,filename).split(path.sep).join('/');
      if(!Object.hasOwn(ARTIFACTS,relative)||fs.realpathSync(filename)!==filename)throw fail();
      actualArtifacts.add(relative);
    }
  }
  if(actualArtifacts.size!==Object.keys(ARTIFACTS).length)throw fail();
  for(const name of actualArtifacts){
    const expected=ARTIFACTS[name],filename=local(name);
    if(digest(fs.readFileSync(filename))!==expected)throw fail();
    inputs['node_modules/@aztec-labs/'+name]=expected;urls.set(pathToFileURL(filename).href,expected);
  }
  let adaptedLoads=0,closed=false;
  const hook=registerHooks({load(url,context,nextLoad){
    const expected=urls.get(url);
    if(!expected)return nextLoad(url,context);
    // Never reinterpret a format, explicit type, unsupported attribute or URL.
    // Preserve the default loader's exact result/error, checking bytes it loaded.
    const missing=context.format==='json'&&Object.keys(context.importAttributes).length===0;
    const result=nextLoad(url,missing?{...context,importAttributes:{type:'json'}}:context);
    if(digest(result.source)!==expected)throw fail();
    if(missing)adaptedLoads++;
    return result;
  }});
  active=true;
  const verify=()=>{
    for(const [name,expected] of Object.entries(inputs)){
      if(digest(fs.readFileSync(local(name.slice('node_modules/@aztec-labs/'.length))))!==expected)throw fail();
    }
  };
  return Object.freeze({
    observation:()=>({adapter:'Node24 pinned JSON import type only; CLI test fixture',nodeVersion:pins.node,packageVersion:VERSION,
      artifactCount:urls.size,adaptedLoads,closed,inputs:{...inputs}}),
    verify,
    close(){if(closed)return;try{verify();}finally{hook.deregister();closed=true;active=false;}},
  });
}
