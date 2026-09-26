import { completionBudget, normalizeUsage } from './completionBudget.mjs';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 180000;

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

async function callAnthropic({ apiKey, model, messages, temperature, maxTokens, system, compact, signal, jsonSchema }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Legacy keeps its 16000 floor; compact uses the bounded v3 budget.
    const body = { model, max_tokens: completionBudget(maxTokens, compact), messages };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (system) body.system = system;
    // Claude has no response_format field; native structured output is a forced tool call.
    if (jsonSchema) {
      body.tools = [{ name: jsonSchema.name, description: 'Return the analysis output matching the schema.', input_schema: jsonSchema.schema }];
      body.tool_choice = { type: 'tool', name: jsonSchema.name };
    }

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text } };
    }
    if (!response.ok || data.error) {
      throw new Error((data?.error?.message || `HTTP ${response.status}`).slice(0, 140));
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callClaude({ apiKey, model, prompt, temperature, maxTokens, expectJson = true, system, compact = false, signal, jsonSchema }) {
  signal?.throwIfAborted();
  let messages = [{ role: 'user', content: prompt }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let usageComplete = true;
  const addUsage = (d) => {
    const measured = normalizeUsage(d?.usage?.input_tokens, d?.usage?.output_tokens);
    if (!measured) { usageComplete = false; return; }
    usage.input_tokens += measured.input_tokens;
    usage.output_tokens += measured.output_tokens;
  };

  let data = await callAnthropic({ apiKey, model, messages, temperature, maxTokens, system, compact, signal, jsonSchema });
  addUsage(data);

  const toolUse = jsonSchema && Array.isArray(data?.content) ? data.content.find((b) => b.type === 'tool_use' && b.name === jsonSchema.name) : undefined;
  if (toolUse) return { text: JSON.stringify(toolUse.input), usedWebSearch: false, usage: compact && !usageComplete ? null : usage };

  // A model can front-load commentary before its JSON regardless of whether
  // tools are involved, so this retry is independent of web search and
  // stays even though the search-tool machinery above does not.
  let text = extractText(data?.content);
  if (expectJson && !text.includes('{')) {
    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: 'Output ONLY the final JSON object now.' },
    ];
    data = await callAnthropic({ apiKey, model, messages, temperature, maxTokens, system, compact, signal });
    addUsage(data);
    text = extractText(data?.content);
  }

  return { text, usedWebSearch: false, usage: compact && !usageComplete ? null : usage,
    ...(compact ? { truncated: ['max_tokens', 'refusal', 'pause_turn'].includes(data.stop_reason) } : {}) };
}
