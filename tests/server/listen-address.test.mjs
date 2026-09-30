import { describe, it, expect, afterEach, vi } from 'vitest';
import { listenArgs } from '../../server/listenAddress.mjs';

describe('listenArgs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('defaults to all interfaces when HOST is unset, matching the live instance today', () => {
    // Stubbed rather than relying on the ambient shell: `npm run test:dev` sources
    // .env.dev, which sets HOST=127.0.0.1, so process.env.HOST is not actually unset
    // in that run — this test is about listenArgs' own default, not the shell's.
    vi.stubEnv('HOST', '');
    expect(listenArgs(8787, undefined)).toEqual([8787]);
  });
  it('binds to HOST when given', () => {
    expect(listenArgs(8887, '127.0.0.1')).toEqual([8887, '127.0.0.1']);
  });
});
