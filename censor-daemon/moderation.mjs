// ============================================================
// moderation.js — LLM moderation logic (testable, no network)
// ============================================================
//
// Exports:
//   parseVerdict(fullText) → { isViolation, reason }
//   buildSystemPrompt() → string
//   buildUserPrompt(postText, policy) → string
//   moderatePost(postText, policy, llamaPort) → { isViolation, reason, rawResponse }
//
// This module is isomorphic — it can be imported by daemon.mjs
// (Node.js) or by a test script. The only network dependency is
// in moderatePost(), which calls the llama-server HTTP API.
// ============================================================

// ============================================================
// Prompt construction
// ============================================================
export function buildSystemPrompt() {
  return `You are a moderation bot for an anonymous billboard. Check if the post breaks any listed rule. Output only your final answer. When in doubt, do not flag.`;
}

export function buildUserPrompt(postText, policy) {
  return `Rules:
${policy}

Post: "${postText}"

Does this post break any rule? Answer with ONLY:
VIOLATION - <rule number> - <one sentence why>
or
OK`;
}

// ============================================================
// Parse LLM verdict — returns { isViolation, reason }
// ============================================================
//
// The model outputs either:
//   VIOLATION - <rule number> - <why>
//   OK
//
// Thinking models may put reasoning before the final answer.
// Strategy: scan from end for a line starting with VIOLATION or OK.
// Extract the explanation after VIOLATION.
// Default: OK (conservative — don't flag when unclear).
//
export function parseVerdict(fullText) {
  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Scan from end for a line containing VIOLATION or OK.
  // The first match from the end wins (the model's final answer).
  for (let i = lines.length - 1; i >= 0; i--) {
    const upper = lines[i].toUpperCase();
    const isNotViolation = upper.includes('NOT A VIOLATION') || upper.includes('NO VIOLATION');

    if (upper.includes('VIOLATION') && !isNotViolation) {
      // Extract reason from same line: "VIOLATION - <rule> - <why>"
      const after = lines[i].replace(/^.*?VIOLATION\s*-?\s*/i, '').trim();
      const reason = (after || lines.slice(0, i).join(' ').trim() || 'Violates moderation policy').substring(0, 200);
      return { isViolation: true, reason };
    }

    if (upper.includes('OK') || isNotViolation) {
      return { isViolation: false, reason: 'No violation' };
    }
  }

  // Conservative default
  return { isViolation: false, reason: 'No clear violation signal — defaulting to OK' };
}

// ============================================================
// LLM moderation — calls llama-server HTTP API
// ============================================================
export async function moderatePost(postText, policy, llamaPort = 5090) {
  const res = await fetch(`http://127.0.0.1:${llamaPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(postText, policy) },
      ],
      temperature: 0.0,
      max_tokens: 512,
      stream: false,
      // Disable thinking mode for Qwen3.x models — makes the model
      // output a direct answer instead of spending tokens on reasoning.
      // This is ignored by non-Qwen models (harmless extra field).
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  // Thinking models: reasoning in reasoning_content, final answer in content.
  // Fall back to reasoning_content if content is empty (ran out of tokens).
  const content = (choice?.message?.content || '').trim();
  const reasoning = (choice?.message?.reasoning_content || '').trim();
  const fullText = content || reasoning;

  const verdict = parseVerdict(fullText);
  return { ...verdict, rawResponse: content || reasoning };
}
