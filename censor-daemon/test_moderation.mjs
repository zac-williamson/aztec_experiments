// ============================================================
// test_moderation.mjs — Unit tests for moderation.mjs
// ============================================================
//
// Tests the pure parsing logic (parseVerdict, buildUserPrompt)
// without any network or llama-server dependency.
//
// Run: node censor-daemon/test_moderation.mjs
// ============================================================

import { parseVerdict, buildSystemPrompt, buildUserPrompt } from './moderation.mjs';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    fail++;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(v, msg) {
  if (!v) throw new Error(msg || 'expected true');
}

function assertFalse(v, msg) {
  if (v) throw new Error(msg || 'expected false');
}

console.log('=== parseVerdict tests ===');

test('simple VIOLATION with rule number and reason', () => {
  const v = parseVerdict('VIOLATION - 2 - This post contains profanity');
  assertTrue(v.isViolation, 'should be violation');
  assertEqual(v.reason, '2 - This post contains profanity');
});

test('simple OK', () => {
  const v = parseVerdict('OK');
  assertFalse(v.isViolation, 'should not be violation');
  assertEqual(v.reason, 'No violation');
});

test('VIOLATION at end after thinking reasoning', () => {
  const text = `Let me check the rules.\nRule 1 is about spam.\nThe post mentions buying a product.\nVIOLATION - 1 - This is advertising spam`;
  const v = parseVerdict(text);
  assertTrue(v.isViolation);
  assertEqual(v.reason, '1 - This is advertising spam');
});

test('OK at end after thinking reasoning', () => {
  const text = `Let me check the rules.\nThe post is just a greeting.\nNo rules are violated.\nOK`;
  const v = parseVerdict(text);
  assertFalse(v.isViolation);
  assertEqual(v.reason, 'No violation');
});

test('NOT A VIOLATION is treated as OK', () => {
  const v = parseVerdict('This is NOT A VIOLATION of any rule.');
  assertFalse(v.isViolation);
});

test('NO VIOLATION is treated as OK', () => {
  const v = parseVerdict('NO VIOLATION found in this post.');
  assertFalse(v.isViolation);
});

test('VIOLATION without reason defaults to policy message', () => {
  const v = parseVerdict('VIOLATION');
  assertTrue(v.isViolation);
  assertEqual(v.reason, 'Violates moderation policy');
});

test('empty text defaults to OK (conservative)', () => {
  const v = parseVerdict('');
  assertFalse(v.isViolation);
});

test('random text without VIOLATION or OK defaults to OK', () => {
  const v = parseVerdict('The post is about cats and dogs.');
  assertFalse(v.isViolation);
});

test('VIOLATION with extra whitespace', () => {
  const v = parseVerdict('  VIOLATION   -   3   -   Spam  ');
  assertTrue(v.isViolation);
  // The regex removes "VIOLATION" and optional dash, leaves the rest
  assertTrue(v.reason.includes('3'));
  assertTrue(v.reason.includes('Spam'));
});

test('multiple lines, VIOLATION is last', () => {
  const text = `First line.\nSecond line.\nVIOLATION - 1 - Spam`;
  const v = parseVerdict(text);
  assertTrue(v.isViolation);
  assertEqual(v.reason, '1 - Spam');
});

test('VIOLATION appears before OK — OK wins (scanned from end)', () => {
  const text = `VIOLATION - 1 - Maybe spam\nActually on reflection this is OK`;
  const v = parseVerdict(text);
  // The last line is "Actually on reflection this is OK" which contains "OK"
  assertFalse(v.isViolation);
});

test('OK appears before VIOLATION — VIOLATION wins (scanned from end)', () => {
  const text = `OK this seems fine\nWait, actually VIOLATION - 2 - Profanity detected`;
  const v = parseVerdict(text);
  assertTrue(v.isViolation);
  assertEqual(v.reason, '2 - Profanity detected');
});

test('reason is truncated to 200 chars', () => {
  const longReason = 'A'.repeat(300);
  const v = parseVerdict(`VIOLATION - 1 - ${longReason}`);
  assertTrue(v.isViolation);
  assertTrue(v.reason.length <= 200, `reason should be <= 200 chars, got ${v.reason.length}`);
});

test('case insensitive VIOLATION', () => {
  const v = parseVerdict('violation - 1 - spam');
  assertTrue(v.isViolation);
});

test('case insensitive OK', () => {
  const v = parseVerdict('ok');
  assertFalse(v.isViolation);
});

console.log('\n=== prompt building tests ===');

test('buildSystemPrompt mentions specific rules', () => {
  const p = buildSystemPrompt();
  assertTrue(p.includes('rule'), 'system prompt should mention rules');
  assertTrue(p.includes('billboard'), 'system prompt should mention billboard');
});

test('buildUserPrompt includes policy and post text', () => {
  const p = buildUserPrompt('Hello world', 'No spam allowed');
  assertTrue(p.includes('No spam allowed'), 'should include policy');
  assertTrue(p.includes('Hello world'), 'should include post text');
  assertTrue(p.includes('VIOLATION'), 'should mention VIOLATION format');
  assertTrue(p.includes('OK'), 'should mention OK format');
});

test('buildUserPrompt handles empty post', () => {
  const p = buildUserPrompt('', 'No spam');
  assertTrue(p.includes('""'), 'should handle empty post');
});

test('buildUserPrompt handles post with quotes', () => {
  const p = buildUserPrompt('He said "hello"', 'No spam');
  assertTrue(p.includes('He said'), 'should include post text with quotes');
});

console.log('\n=== integration-style tests (parseVerdict on realistic LLM outputs) ===');

test('thinking model output with reasoning_content style', () => {
  // Simulates what a thinking model might output
  const text = `Let me analyze this post against the policy.

The policy says no spam or advertising.
The post says "Buy cheap watches at example.com".
This is clearly advertising.

VIOLATION - 1 - The post contains advertising for a product`;
  const v = parseVerdict(text);
  assertTrue(v.isViolation);
  assertTrue(v.reason.includes('advertising'));
});

test('thinking model output that concludes OK', () => {
  const text = `Let me analyze this post.

The post says "Hello everyone, nice to meet you".
This is a friendly greeting.
No rules are violated.

OK`;
  const v = parseVerdict(text);
  assertFalse(v.isViolation);
});

test('model output with markdown formatting', () => {
  const text = `**Analysis:** The post violates rule 2.

**VIOLATION - 2 - Contains profanity**`;
  const v = parseVerdict(text);
  assertTrue(v.isViolation);
});

console.log(`\n=== Results ===`);
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
