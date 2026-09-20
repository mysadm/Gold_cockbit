// The pre-multi-user GOLD_COCKPIT_API_KEY header check is still mounted inside
// several routers. The browser never sends that header, so leaving the variable
// set would make every data request 401 right after a successful login. Sessions
// replace it: drop the variable at start-up so the check stays a no-op.
export function neutralizeLegacyApiKey(env = process.env, warn = console.warn) {
  if (!env.GOLD_COCKPIT_API_KEY) return false;
  warn(
    'GOLD_COCKPIT_API_KEY is set but is not supported by the multi-user server (sessions replace it). ' +
      'Ignoring it; remove it from your environment or .env file.'
  );
  delete env.GOLD_COCKPIT_API_KEY;
  return true;
}
