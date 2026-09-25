import { describe, it, expect } from 'vitest';
import { listenArgs } from '../../server/listenAddress.mjs';

describe('listenArgs', () => {
  it('defaults to all interfaces when HOST is unset, matching the live instance today', () => {
    expect(listenArgs(8787, undefined)).toEqual([8787]);
  });
  it('binds to HOST when given', () => {
    expect(listenArgs(8887, '127.0.0.1')).toEqual([8887, '127.0.0.1']);
  });
});
