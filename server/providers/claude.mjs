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

async function callAnthropic({ apiKey, model, messages, temperature, maxTokens, system }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // 16000 (not 8000): the response schema spans up to 7 written fields
    // (one_liner, trends, weights_reasoning, tranche2, egp_read, wallet_read,
    // watchlist_read), and 8000 was getting exhausted before the JSON was
    // fully written, truncating it mid-string. A user-configured maxTokens
    // can only raise this floor, never lower it.
    const body = { model, max_tokens: Math.max(maxTokens || 0, 16000), messages };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (system) body.system = system;

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
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

export async function callClaude({ apiKey, model, prompt, temperature, maxTokens, expectJson = true, system }) {
  let messages = [{ role: 'user', content: prompt }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const addUsage = (d) => {
    if (!d?.usage) return;
    usage.input_tokens += d.usage.input_tokens || 0;
    usage.output_tokens += d.usage.output_tokens || 0;
  };

  let data = await callAnthropic({ apiKey, model, messages, temperature, maxTokens, system });
  addUsage(data);

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
    data = await callAnthropic({ apiKey, model, messages, temperature, maxTokens, system });
    addUsage(data);
    text = extractText(data?.content);
  }

  return { text, usedWebSearch: false, usage };
}
