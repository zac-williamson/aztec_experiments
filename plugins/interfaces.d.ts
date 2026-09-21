/** Public interfaces for alternate plugin implementations. All IDs are public. */
export interface Scope {
  chainId: string; rollupAddress: string; rollupVersion: string;
  boardAddress: string; receiver: string;
}
export interface Descriptor {
  protocol: 'billboard-plugin/v1'; scope: Scope; description: string;
  payment: {protocol:'ethereum-eth/v1';chainId:string;contractAddress:string;amountWei:string};
}
export interface Payment {
  postId:string; messageHash:string; payer:string; amountWei:string;
  transactionHash:string; blockHash:string; blockNumber:number;
}
export interface PaymentSource {
  verify():Promise<void>;
  events(fromBlock:number,toBlock:number):Promise<Payment[]>;
  verifyEvent(payment:Payment):Promise<void>;
}
export interface BoardRequest {
  text:string; receiver:string; enabled:boolean; flagged:boolean;
  finalized:boolean; replyPostId:string|null;
}
export interface BoardPort {
  readRequest(postId:string):Promise<BoardRequest|null>;
  reply(postId:string,text:string):Promise<unknown>;
}
export interface DispatchStore {claim(id:string):boolean|Promise<boolean>}
export interface RunRequest {id:string;postId:string;text:string;amountWei:string;modelId?:string}
export interface Runner {run(request:RunRequest):Promise<{replyText:string}>}
export interface WorkerDependencies {
  scope:Scope; payments:PaymentSource; board:BoardPort; dispatch:DispatchStore; runner:Runner;
}
export type WorkerResult={state:'waiting-for-post'|'waiting-for-finality'|'ineligible'|'already-dispatched'|'replied'};
export interface PluginWorker {handle(payment:Payment):Promise<WorkerResult>}
export interface ToolDefinition {
  type:'function';function:{name:string;description:string;parameters:Record<string,unknown>};
}
export interface ToolCall {id:string;type:'function';function:{name:string;arguments:string}}
export interface ModelMessage {
  role:'system'|'user'|'assistant'|'tool'; content:string|null;
  tool_calls?:ToolCall[];tool_call_id?:string;
}
export interface ModelPort {
  /** Cost charged to the action allowance, in USD; may conservatively exceed provider billing. */
  complete(input:{messages:ModelMessage[];tools:ToolDefinition[];maxTokens:number;modelId?:string}):Promise<{message:ModelMessage;cost:number}>;
}
export interface ToolSession {
  definitions:ToolDefinition[];
  call(name:string,args:Record<string,unknown>):Promise<unknown>;
  summary(reason:string):string;
  close():Promise<void>;
}
export interface Toolbox {open(request:{id:string;postId:string}):Promise<ToolSession>}
