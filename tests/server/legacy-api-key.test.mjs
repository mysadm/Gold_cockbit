import { describe, it, expect, vi } from 'vitest';
import { neutralizeLegacyApiKey } from '../../server/legacyApiKey.mjs';

describe('neutralizeLegacyApiKey', () => {
  it('warns and removes GOLD_COCKPIT_API_KEY when it is set', () => {
    const env = { GOLD_COCKPIT_API_KEY: 'secret', OTHER: 'kept' };
    const warn = vi.fn();
    expect(neutralizeLegacyApiKey(env, warn)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/GOLD_COCKPIT_API_KEY/);
    expect(warn.mock.calls[0][0]).toMatch(/not supported/i);
    expect(warn.mock.calls[0][0]).not.toMatch(/secret/);
    expect('GOLD_COCKPIT_API_KEY' in env).toBe(false);
    expect(env.OTHER).toBe('kept');
  });

  it.each([[{}], [{ GOLD_COCKPIT_API_KEY: '' }]])('does nothing when unset or empty (%j)', (env) => {
    const warn = vi.fn();
    expect(neutralizeLegacyApiKey(env, warn)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
