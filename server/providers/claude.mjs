const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 90000;

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

async function callAnthropic({ apiKey, model, messages, withTools }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const body = { model, max_tokens: 4000, messages };
    if (withTools) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

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

export async function callClaude({ apiKey, model, prompt }) {
  let messages = [{ role: 'user', content: prompt }];
  let data;
  let usedWebSearch = true;

  try {
    data = await callAnthropic({ apiKey, model, messages, withTools: true });
  } catch (firstErr) {
    try {
      data = await callAnthropic({ apiKey, model, messages, withTools: false });
      usedWebSearch = false;
    } catch {
      throw firstErr;
    }
  }

  let text = extractText(data?.content);
  if (!text.includes('{')) {
    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: 'Output ONLY the final JSON object now.' },
    ];
    data = await callAnthropic({ apiKey, model, messages, withTools: false });
    text = extractText(data?.content);
  }

  return { text, usedWebSearch };
}
