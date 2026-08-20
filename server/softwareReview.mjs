const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5-coder:7b';
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

const REVIEW_ROLES = [
  ['SEC', 'Security and privacy', 'Inspect trust boundaries, authentication, authorization, user isolation, validation, encoding, secrets, logs, injection, SSRF, file and path handling, data exposure, rate limiting, and secure defaults.'],
  ['UX', 'Usability and accessibility', 'Inspect user journeys, labels, feedback, validation, recovery, loading, empty and error states, keyboard and focus behavior, semantics, contrast, responsiveness, and localization.'],
  ['ARC', 'Architecture and maintainability', 'Inspect boundaries, coupling, duplication, state ownership, domain modeling, configuration, error handling, observability, migration safety, contracts, complexity, and consistency.'],
  ['TST', 'Testing and quality control', 'Inspect critical and negative path coverage, boundaries, assertions, determinism, fixtures, isolation, concurrency, contracts, migrations, and regression risk.'],
  ['REL', 'Reliability and performance', 'Inspect timeouts, retries, idempotency, transactions, races, cleanup, caching, pagination, query patterns, unbounded work, lifecycle behavior, dependency failures, and operational visibility.'],
];

function localOllamaUrl(value = DEFAULT_OLLAMA_URL) {
  const url = new URL(value);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'ollama']);
  if (url.protocol !== 'http:' || !allowedHosts.has(url.hostname)) {
    throw new Error('OLLAMA_BASE_URL must be a local HTTP host');
  }
  return url.toString().replace(/\/$/, '');
}

async function ollamaChat(prompt, { fetchImpl, baseUrl, model }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${localOllamaUrl(baseUrl)}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'Be a precise software assurance specialist. Never claim execution or observations absent from supplied evidence.' },
          { role: 'user', content: prompt },
        ],
        options: { temperature: 0.1 },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `Ollama HTTP ${response.status}`);
    return data?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

export async function runLocalSoftwareReview(input, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = options.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
  const model = input.model || options.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  const common = `Project: ${input.project}\nScope: ${input.scope}\n\nCODE CONTEXT\n${input.codeContext}`;

  if (input.action === 'refactor') {
    const prompt = `You are the refactor integrator. Work only on approved findings: ${input.approvedFindingIds.join(', ')}. Use the prior report and supplied code. Propose the smallest cohesive changes. Return assumptions, affected files, a unified diff when context is sufficient, tests, verification commands, compatibility risks, and rollback. Do not invent omitted code and do not claim execution.\n\nPRIOR REPORT\n${input.reviewReport}\n\n${common}`;
    const proposal = await ollamaChat(prompt, { fetchImpl, baseUrl, model });
    return { action: 'refactor', model, proposalMarkdown: proposal };
  }

  const reviews = await Promise.all(REVIEW_ROLES.map(async ([prefix, role, focus]) => {
    const prompt = `You are the ${role} reviewer. ${focus} Diagnose only. Report evidence-backed findings with ID prefix ${prefix}, priority P0-P3, confidence, location, evidence, impact, recommendation, tests, and acceptance criteria. Include coverage, limitations, positive controls, and items needing validation.\n\n${common}`;
    return { role, text: await ollamaChat(prompt, { fetchImpl, baseUrl, model }) };
  }));

  const evidence = reviews.map(({ role, text }) => `## ${role}\n${text}`).join('\n\n');
  const reportPrompt = `You are the review coordinator. Consolidate the independent reviews below. Deduplicate by root cause, retain affected locations, reject unsupported claims, order P0 to P3, and preserve uncertainty. Return Markdown with executive summary, release recommendation, coverage table, findings, staged roadmap, verification record, positive controls, and residual risks. Each finding needs ID, priority, confidence, category, location, evidence, impact, recommendation, tests and acceptance criteria, rollout or rollback, and status Open.\n\n${evidence}`;
  const reportMarkdown = await ollamaChat(reportPrompt, { fetchImpl, baseUrl, model });
  return { action: 'review', model, reportMarkdown };
}

