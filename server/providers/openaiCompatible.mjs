import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { completionBudget, normalizeUsage } from './completionBudget.mjs';

const REQUEST_TIMEOUT_MS = 180000;

async function abortable(promise, signal) {
  signal.throwIfAborted();
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

function isBlockedAddress(address) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && (b & 0xc0) === 0x40) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  if (ipVersion === 6) {
    return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe8') || address.startsWith('::');
  }

  return false;
}

export async function validateBaseUrl(baseUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error('Invalid provider base URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https provider base URLs are allowed');
  }

  if (parsedUrl.hostname === 'localhost') {
    return parsedUrl.toString();
  }

  try {
    const addresses = await lookup(parsedUrl.hostname, { all: true });
    const blocked = addresses.some(({ address }) => isBlockedAddress(address));
    if (blocked) {
      throw new Error('Blocked provider base URL');
    }
  } catch (error) {
    if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') {
      return parsedUrl.toString();
    }
    throw error;
  }

  return parsedUrl.toString();
}

// Most OpenAI-compatible providers return errors as { error: { message } },
// but Google's Gemini OpenAI-compat layer wraps it in an array instead:
// [{ error: { message } }]. Without this, a Gemini error (bad API key, wrong
// model name, etc.) silently falls through to the generic "HTTP 404"/"HTTP
// 400" fallback below, hiding the actual reason from the user.
function extractErrorMessage(data) {
  if (Array.isArray(data)) return data[0]?.error?.message;
  return data?.error?.message;
}

async function postChatCompletion(baseUrl, headers, model, messages, signal, temperature, maxTokens, compact, tokenLimitParameter) {
  // Legacy keeps its 16000 floor; compact uses the bounded v3 budget.
  const body = { model, messages, [tokenLimitParameter]: completionBudget(maxTokens, compact) };
  if (typeof temperature === 'number') body.temperature = temperature;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(body),
  });

  // A malformed base URL (e.g. a trailing slash producing a double slash
  // before /chat/completions) can route to a 404 with an empty/non-JSON
  // body — .json() would throw "Unexpected end of JSON input" and mask the
  // actual HTTP status, so parse defensively instead of letting that escape.
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data) || `HTTP ${response.status}`);
  }

  return { text: typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : '',
    usage: normalizeUsage(data?.usage?.prompt_tokens, data?.usage?.completion_tokens),
    truncated: ['length', 'content_filter'].includes(data?.choices?.[0]?.finish_reason) };
}

export async function callOpenAICompatible({ baseUrl, apiKey, model, prompt, temperature, maxTokens, expectJson = true, system, compact = false, signal, tokenLimitParameter = 'max_tokens' }) {
  signal?.throwIfAborted();
  if (!['max_tokens', 'max_completion_tokens'].includes(tokenLimitParameter)) throw new Error('Unsupported completion limit parameter');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const safeBaseUrl = (await abortable(validateBaseUrl(baseUrl), requestSignal)).replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let messages = system
      ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];
    let result = await postChatCompletion(safeBaseUrl, headers, model, messages, requestSignal, temperature, maxTokens, compact, tokenLimitParameter);
    let { text, usage } = result;

    if (expectJson && !text.includes('{')) {
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: 'Output ONLY the final JSON object now.' },
      ];
      result = await postChatCompletion(safeBaseUrl, headers, model, messages, requestSignal, temperature, maxTokens, compact, tokenLimitParameter);
      text = result.text;
      usage = usage && result.usage ? { input_tokens: usage.input_tokens + result.usage.input_tokens, output_tokens: usage.output_tokens + result.usage.output_tokens } : null;
    }

    return { text, usedWebSearch: false, ...(compact ? { usage, truncated: result.truncated } : usage ? { usage } : {}) };
  } finally {
    clearTimeout(timeout);
  }
}
