import { lookup } from 'node:dns/promises';
import net from 'node:net';

const REQUEST_TIMEOUT_MS = 180000;

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

async function validateBaseUrl(baseUrl) {
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

export async function callOpenAICompatible({ baseUrl, apiKey, model, prompt }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const safeBaseUrl = await validateBaseUrl(baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${safeBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `HTTP ${response.status}`);
    }

    const text = data?.choices?.[0]?.message?.content || '';
    return { text, usedWebSearch: false };
  } finally {
    clearTimeout(timeout);
  }
}
