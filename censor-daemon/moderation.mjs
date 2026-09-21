import promptTemplate from './prompt-template.json' with {type:'json'};
import {INFERENCE_OPTIONS} from './runtime-configuration.mjs';
// Structured moderation decisions. This module receives public post/policy text
// only; it has no signer, command, wallet-path, or transaction-destination API.
export const MAX_REASON_BYTES = 200;
export const LIMITS = Object.freeze({ postBytes: 1024, policyBytes: 8192, verdictBytes: 4096, responseBytes: 32768, timeoutMs: 120000 });
const encoder = new TextEncoder();
const forbiddenControls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const forbiddenFramingControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

export class ModerationError extends Error {
  constructor(code, message) { super(message); this.name = 'ModerationError'; this.code = code; }
}
const invalid = (code, message) => { throw new ModerationError(code, message); };

export function validateReason(reason) {
  if (typeof reason !== 'string' || reason.length > MAX_REASON_BYTES || !reason.isWellFormed() || forbiddenControls.test(reason)) invalid('INVALID_REASON', 'Moderation reason must be bounded, well-formed text without control characters');
  const normalized = reason.trim();
  if (!normalized || encoder.encode(normalized).byteLength > MAX_REASON_BYTES || normalized.startsWith('--')) {
    invalid('INVALID_REASON', `Moderation reason must contain 1–${MAX_REASON_BYTES} UTF-8 bytes and cannot start with --`);
  }
  return normalized;
}

function validateInput(text, name, maxBytes) {
  if (typeof text !== 'string' || text.length > maxBytes || !text.isWellFormed() || encoder.encode(text).byteLength > maxBytes || forbiddenFramingControls.test(text)) {
    invalid('INVALID_INPUT', `${name} must be valid text of at most ${maxBytes} UTF-8 bytes without control characters`);
  }
}

export function buildSystemPrompt() {
  return promptTemplate.system;
}

export function buildUserPrompt(postText, policy) {
  validateInput(postText, 'Post', LIMITS.postBytes);
  validateInput(policy, 'Policy', LIMITS.policyBytes);
  return promptTemplate.userPrefix + JSON.stringify({ policy, post: postText });
}

export function parseVerdict(fullText) {
  if (typeof fullText !== 'string' || fullText.length > LIMITS.verdictBytes || !fullText.isWellFormed() || encoder.encode(fullText).byteLength > LIMITS.verdictBytes || forbiddenFramingControls.test(fullText)) {
    invalid('INVALID_VERDICT', 'Model verdict must be bounded, well-formed text');
  }
  const text = fullText.trim();
  if (!text) invalid('INVALID_VERDICT', 'Model returned no final verdict');
  let value;
  try { value = JSON.parse(text); } catch { invalid('INVALID_VERDICT', 'Model verdict is not valid JSON'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== 2
      || !Object.hasOwn(value, 'isViolation') || !Object.hasOwn(value, 'reason') || typeof value.isViolation !== 'boolean') {
    invalid('INVALID_VERDICT', 'Model verdict must contain only boolean isViolation and string reason');
  }
  // JSON.parse permits duplicate keys. Count colons outside valid JSON strings
  // to reject duplicates as well; the accepted values are both primitives.
  const colonCount = (text.replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""').match(/:/g) || []).length;
  if (colonCount !== 2) invalid('INVALID_VERDICT', 'Model verdict contains duplicate or nested fields');
  return Object.freeze({ isViolation: value.isViolation, reason: validateReason(value.reason) });
}

async function readResponse(response, signal) {
  const size = response.headers.get('content-length');
  if (size !== null && (!/^[0-9]+$/.test(size) || Number(size) > LIMITS.responseBytes)) {
    await response.body?.cancel();
    invalid('RESPONSE_TOO_LARGE', 'Model HTTP response exceeds its size limit');
  }
  if (!response.body) invalid('INVALID_RESPONSE', 'Model returned an empty HTTP response');
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMITS.responseBytes) invalid('RESPONSE_TOO_LARGE', 'Model HTTP response exceeds its size limit');
      chunks.push(value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined)); }
    catch { invalid('INVALID_RESPONSE', 'Model returned malformed JSON or UTF-8'); }
    return data;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function moderatePost(postText, policy, llamaPort = 5090, { fetch: fetchFn = globalThis.fetch, timeoutMs = LIMITS.timeoutMs } = {}) {
  const userPrompt = buildUserPrompt(postText, policy);
  if (!Number.isInteger(llamaPort) || llamaPort < 1 || llamaPort > 65535) invalid('INVALID_INPUT', 'Model port must be an integer between 1 and 65535');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.timeoutMs) invalid('INVALID_INPUT', 'Invalid model request timeout');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new ModerationError('MODEL_TIMEOUT', 'Model request timed out; post remains unresolved');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchFn(`http://127.0.0.1:${llamaPort}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content: userPrompt }],
          ...INFERENCE_OPTIONS,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        invalid('MODEL_HTTP_ERROR', `Model HTTP request failed (${response.status}); post remains unresolved`);
      }
      const data = await readResponse(response, controller.signal);
      const choice = data?.choices?.[0];
      if (!Array.isArray(data?.choices) || data.choices.length !== 1 || choice?.finish_reason !== 'stop'
          || typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) {
        invalid('INVALID_RESPONSE', 'Model response lacks one complete final text verdict');
      }
      // Incomplete reasoning is never substituted for a missing final answer.
      return { ...parseVerdict(choice.message.content), rawResponse: choice.message.content };
    })()]);
  } catch (error) {
    if (error instanceof ModerationError) throw error;
    if (controller.signal.aborted) throw controller.signal.reason;
    throw new ModerationError('MODEL_UNAVAILABLE', 'Model request failed; post remains unresolved');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
