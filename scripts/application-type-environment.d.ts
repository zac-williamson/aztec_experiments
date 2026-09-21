// SDK/host dependencies are private to the application adapter, not its UI contract.
interface Window {walletState:any;__aztec:any;BillboardPublic:any;BillboardConfig:any;billboardConfigStore:any;unpackFieldsToString:any;BillboardAccount:any;BillboardWalletBackup:any;BillboardClaimBackup:any;ethereum:any;}
declare const BILLBOARD_ARTIFACT:object, BILLBOARD_PRIVATE_FEE_ARTIFACT:object, PORTAL_BYTECODE:string;
declare function _getConfigRevision():number;
declare function _getPublicConfig():any;
declare function makeCallEngine(engine:Function,environment:object,options:object):(action:string,progress:Function,input:object)=>Promise<any>;
declare function runDeploy(environment:any,config:any):Promise<any>;
declare function runFeeJuiceFlow(environment:any,config:any):Promise<any>;
declare function runBillboardUser(environment:any,config:any):Promise<any>;
declare function makeClaimSecretStore(secret:string,salt:string):any;
declare function readBillboardDepositInfo(contract:any,address:any,chain:any):Promise<any>;
declare function getL2Timestamp(node:any):Promise<number>;
declare function extractInt(result:any):bigint;

declare const ethers:any, BillboardPasskey:any;
