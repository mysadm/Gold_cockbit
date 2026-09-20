import { describe, it, expect, afterEach } from 'vitest';
import { createApp } from '../../server/createApp.mjs';

const original = process.env.TRUST_PROXY;
afterEach(() => {
  if (original === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = original;
});

// createApp only stores the db handle for later requests, so a stub is enough here.
const trustProxyFor = (value) => {
  if (value === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = value;
  return createApp({}, { adminId: 'unused' }).get('trust proxy');
};

describe('TRUST_PROXY', () => {
  it.each(['0', 'false', 'FALSE', '', 'no', 'yes', '2'])('is not enabled for %j', (value) => {
    expect(trustProxyFor(value)).toBeFalsy();
  });

  it('is not enabled when unset', () => {
    expect(trustProxyFor(undefined)).toBeFalsy();
  });

  it.each(['1', 'true', 'TRUE', 'True', ' true '])('is enabled (one hop) for %j', (value) => {
    expect(trustProxyFor(value)).toBe(1);
  });
});
