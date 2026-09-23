/** Public protocol and hosted-service ports. Provider/tool implementations are replaceable. */
export interface Scope {chainId:string;rollupAddress:string;rollupVersion:string;boardAddress:string;receiver:string}
export interface Descriptor {protocol:'billboard-plugin/v2';scope:Scope;description:string;funding:{protocol:'aztec-escrow-usdc/v1';portalAddress:string;tokenAddress:string}}
export interface Reservation {call:number;maximum:bigint}
export interface MeasuredCall extends Reservation {actual:bigint;receipt:string}
export interface EscrowPort {
 available(postId:string):Promise<bigint>;
 reserve(postId:string,maximum:bigint):Promise<Reservation>;
 assertUsable(postId:string,reservation:Reservation):Promise<void>;
 settle(postId:string,call:MeasuredCall):Promise<unknown>;
 complete(postId:string,call:MeasuredCall|null,reply:string):Promise<unknown>;
 close(postId:string):Promise<unknown>;
}
export interface ModelMessage {role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:ToolCall[];tool_call_id?:string}
export interface ToolCall {id:string;type:'function';function:{name:string;arguments:string}}
export interface ToolDefinition {type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}}
export interface ModelInput {messages:ModelMessage[];tools:ToolDefinition[];maxTokens:number;modelId?:string}
export interface ModelPort {complete(input:ModelInput):Promise<{message:ModelMessage;cost:number}>}
export interface ToolSession {definitions:ToolDefinition[];call(name:string,args:Record<string,unknown>):Promise<unknown>;summary(reason:string):string;close():Promise<void>}
export interface Toolbox {open(request:{id:string;postId:string}):Promise<ToolSession>}
export interface Runner {run(request:{id:string;postId:string;text:string;modelId?:string}):Promise<{replyText:string}>}
/** States: 1 queued, 2 active, 3 replied, 4 cancelled, 5 released, 6 stopped, 7 uncertain. */
export interface Invocation {account:unknown;state:number;call:number;reserved:bigint;charged:bigint;deadline:number}
export interface EscrowPort {
 count():Promise<number>;
 at(index:number):Promise<string>;
 invocation(postId:string):Promise<Invocation>;
 start(postId:string):Promise<unknown>;
}
export interface BoardRequest {text:string;receiver:string;enabled:boolean;flagged:boolean;replyPostId:string|null;finalized:boolean}
export interface BoardPort {readRequest(postId:string):Promise<BoardRequest|null>}
export interface Quote {maximum:bigint;maxTokens:number;modelId:string;inputBound:number;inputPrice:bigint;outputPrice:bigint;cachePrice:bigint|null}
export interface MeteredProvider {
 quote(input:ModelInput,available:bigint):Promise<Quote>;
 execute(input:ModelInput,quote:Quote):Promise<{message:ModelMessage;charge:bigint;receipt:string}>;
}
