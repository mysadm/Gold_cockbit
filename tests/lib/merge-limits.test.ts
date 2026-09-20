import { describe, it, expect } from 'vitest';
import { mergeLimits } from '../../src/lib/mergeLimits';

describe('mergeLimits', () => {
  it('takes the server value for rows the admin has not edited', () => {
    expect(mergeLimits({ a: '3' }, { a: '3' }, { a: '5' })).toEqual({ a: '5' });
  });

  it('keeps an unsaved edit in one row when another row is refreshed', () => {
    const merged = mergeLimits({ a: '3', b: '3' }, { a: '9', b: '3' }, { a: '3', b: '3' });
    expect(merged).toEqual({ a: '9', b: '3' });
  });

  it('syncs a just-saved row to the server value even though it was edited', () => {
    expect(mergeLimits({ a: '3' }, { a: '05' }, { a: '5' }, ['a'])).toEqual({ a: '5' });
  });

  it('adds new rows, drops removed rows, and leaves an edit alone when the server value also changed', () => {
    const merged = mergeLimits({ a: '3', gone: '3' }, { a: '7', gone: '3' }, { a: '4', fresh: '3' });
    expect(merged).toEqual({ a: '7', fresh: '3' });
  });
});
