const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_OLLAMA_MODEL = 'gemma4:12b';

export async function ensureDefaultLlmProvider(db, userId) {
  const { rows } = await db.query('SELECT id FROM llm_providers WHERE user_id = $1', [userId]);
  if (rows.length > 0) return;

  await db.query(
    `INSERT INTO llm_providers (user_id, provider_type, label, base_url, model, is_active)
     VALUES ($1, 'ollama', 'Local (Ollama)', $2, $3, true)`,
    [userId, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL]
  );
}
