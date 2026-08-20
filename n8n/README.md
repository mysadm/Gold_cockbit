# Local n8n Software Review Workflow

This uses the same pattern as Course Factory:

```text
n8n webhook -> local Gold Cockpit API -> local Ollama -> review report
```

No OpenAI API key, paid model API, or cloud fallback is used.

## 1. Start Ollama

Install Ollama, then pull a code model:

```bash
ollama pull qwen2.5-coder:7b
ollama serve
```

The default is `qwen2.5-coder:7b`. Override it with `OLLAMA_MODEL`. Larger code models may improve review quality if the machine has enough memory.

## 2. Configure the Gold Cockpit server

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:7b
SERVER_PORT=8787
```

Start the existing server with `npm run server`. The local endpoint is:

```text
POST http://localhost:8787/api/software-review/run
```

The service only accepts local Ollama hosts: `localhost`, loopback, `host.docker.internal`, or a Docker service named `ollama`.

## 3. Configure n8n

Import `software-review-refactor.workflow.json` and expose this environment variable to n8n:

```env
GOLD_COCKPIT_API_URL=http://host.docker.internal:8787
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

If n8n runs directly on the host, use `http://localhost:8787`. Activate the imported workflow after protecting its webhook with authentication or a local reverse proxy.

## 4. Review code

Send a POST request to the n8n webhook:

```json
{
  "action": "review",
  "request_id": "PR-123",
  "project": "gold-cockpit",
  "scope": "Pull request 123 diff",
  "code_context": "diff --git a/server/example.mjs b/server/example.mjs\n..."
}
```

The local service runs five specialist reviews concurrently, then a sixth local coordinator pass. The response contains `reportMarkdown`.

## 5. Request an approved refactor proposal

```json
{
  "action": "refactor",
  "request_id": "PR-123-fix-1",
  "project": "gold-cockpit",
  "scope": "Approved fixes",
  "approved_finding_ids": ["SEC-01", "TST-02"],
  "review_report": "# Software Review Report\n...",
  "code_context": "Relevant complete files or diff..."
}
```

The response contains `proposalMarkdown`. The system proposes a patch but does not apply or push it.

## Safety and limits

- Do not include secrets in `code_context`.
- Input is limited to 120,000 characters; split large reviews by subsystem.
- Successful n8n executions are not retained by default.
- Local processing removes model API fees but does not guarantee that submitted code is safe or correct.
- Protect the n8n webhook before exposing it beyond the local network.
