// Diagnostic classifications only; never request/response text or arbitrary error
// properties. Codes come from https://docs.venice.ai/api-reference/error-codes;
// params are exact chat-completion field names, not provider-supplied paths.
const owned=new WeakMap(),responseStatuses=new WeakMap();
const codes=new Set(['AUTHENTICATION_FAILED','AUTHENTICATION_FAILED_INACTIVE_KEY','X402_INVALID_SIGN_IN','PRO_ONLY_MODEL',
 'INSUFFICIENT_BALANCE','API_KEY_DIEM_SPEND_LIMIT_EXCEEDED','API_KEY_USD_SPEND_LIMIT_EXCEEDED','UNAUTHORIZED','API_ACCESS_DISABLED',
 'X402_WALLET_MISMATCH','INVALID_REQUEST','INVALID_MODEL','TOO_MANY_TOKENS','MODEL_NOT_FOUND','PAYLOAD_TOO_LARGE',
 'INVALID_CONTENT_TYPE','CONTENT_POLICY_VIOLATION','RATE_LIMIT_EXCEEDED','MODEL_OVERLOADED','INFERENCE_FAILED','UNKNOWN_ERROR',
 'MODEL_OFFLINE','MODEL_AT_CAPACITY','REQUEST_TIMEOUT','context_length_exceeded']);
const params=new Set(['model','messages','tools','max_completion_tokens','max_tokens','n','stream','venice_parameters',
 'venice_parameters.include_venice_system_prompt','venice_parameters.enable_web_search','venice_parameters.enable_web_scraping','venice_parameters.enable_x_search']);
const stages=new Set(['missing-result/usage','cap','cached-billing','final-receipt-validation']);
const categories=new Set(['http-rejection','transport-unknown','response-json-invalid','billing-validation']);
const finishReasons=new Set(['stop','length','tool_calls','content_filter','function_call']);
// Closed response metadata only; never retain model text or provider-supplied labels.
export function veniceFinishReason(value){return value===undefined?null:typeof value==='string'&&finishReasons.has(value)?value:'invalid';}
function data(value,key) {
 try {const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}catch{return undefined;}
}
export function veniceDiagnosticError(category,options={}) {
 const kind=categories.has(category)?category:'transport-unknown';
 const status=data(options,'httpStatus'),body=data(options,'body'),stage=data(options,'billingStage'),nested=data(body,'error');
 const nestedCode=data(nested,'code'),nestedParam=data(nested,'param');
 const code=nestedCode===undefined?data(body,'code'):nestedCode,param=nestedParam===undefined?data(body,'param'):nestedParam;
 const record=Object.freeze({category:kind,httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,
  code:kind==='http-rejection'&&typeof code==='string'&&codes.has(code)?code:null,
  param:kind==='http-rejection'&&typeof param==='string'&&params.has(param)?param:null,
  billingStage:kind==='billing-validation'&&stages.has(stage)?stage:null});
 const error=new Error(kind==='billing-validation'?'Venice billing validation failed.':kind==='http-rejection'?'Venice request was rejected.':kind==='response-json-invalid'?'Venice response JSON was invalid.':'Venice request outcome is unknown.');
 owned.set(error,record);return error;
}
/** Unknown errors (including getters/proxies/forged diagnostics) yield null. */
export function getVeniceDiagnostic(error) { return owned.get(error)??null; }

// Preserve successful HTTP status out of band without adding provider-visible keys
// or changing json() return values. Non-object JSON has no attributable metadata.
export function recordVeniceResponse(value,status) {
 if(value!==null&&typeof value==='object'&&Number.isInteger(status)&&status>=200&&status<300)responseStatuses.set(value,status);
 return value;
}
export function getVeniceResponseStatus(value) { return responseStatuses.get(value)??null; }
