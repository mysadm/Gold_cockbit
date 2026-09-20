import { describe, it, expect, vi, afterEach } from 'vitest';
import { errorHandler } from '../../server/createApp.mjs';

afterEach(() => vi.restoreAllMocks());

const fakeRes = (headersSent) => {
  const res = { headersSent };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('errorHandler', () => {
  it('hands the error to Express when the response has already started', () => {
    const res = fakeRes(true);
    const next = vi.fn();
    const err = new Error('late failure');
    errorHandler(err, {}, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('answers 500 JSON and logs otherwise', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeRes(false);
    const next = vi.fn();
    const err = new Error('boom');
    errorHandler(err, {}, res, next);
    expect(spy).toHaveBeenCalledWith(err);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    expect(next).not.toHaveBeenCalled();
  });
});
