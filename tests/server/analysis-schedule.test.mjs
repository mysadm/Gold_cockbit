import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULE, normalizeSchedule, currentSlot } from '../../server/analysisSchedule.mjs';

const utc = { ...DEFAULT_SCHEDULE, tz: 'UTC', enabled: true };

describe('normalizeSchedule', () => {
  it('fills defaults, sorts and de-duplicates times', () => {
    expect(normalizeSchedule({ times: ['16:00', '08:00', '08:00'] })).toEqual({ enabled: false, times: ['08:00', '16:00'], tz: 'Africa/Cairo', language: 'ar' });
  });
  it.each([
    [{ enabled: 'yes' }], [{ times: [] }], [{ times: ['8:00'] }], [{ times: ['24:00'] }],
    [{ times: ['01:00', '02:00', '03:00', '04:00', '05:00'] }], [{ tz: 'Mars/Base' }], [{ language: 'fr' }],
  ])('rejects %j', (bad) => {
    expect(() => normalizeSchedule(bad)).toThrow();
  });
});

describe('currentSlot (UTC)', () => {
  it('between the two times', () => {
    const s = currentSlot(new Date('2026-09-21T09:30:00Z'), utc);
    expect(s.key).toBe('2026-09-21@08:00');
    expect(s.startedAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
    expect(s.nextAt.toISOString()).toBe('2026-09-21T16:00:00.000Z');
  });
  it("before the first time uses yesterday's last slot", () => {
    const s = currentSlot(new Date('2026-09-21T07:00:00Z'), utc);
    expect(s.key).toBe('2026-09-20@16:00');
    expect(s.nextAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
  });
  it("after the last time, next is tomorrow's first", () => {
    const s = currentSlot(new Date('2026-09-21T17:00:00Z'), utc);
    expect(s.key).toBe('2026-09-21@16:00');
    expect(s.nextAt.toISOString()).toBe('2026-09-22T08:00:00.000Z');
  });
  it('exactly at a slot time belongs to that slot; handles month rollover', () => {
    expect(currentSlot(new Date('2026-10-01T08:00:00Z'), utc).key).toBe('2026-10-01@08:00');
    expect(currentSlot(new Date('2026-10-01T05:00:00Z'), utc).key).toBe('2026-09-30@16:00');
  });
});

describe('currentSlot (Africa/Cairo, DST-safe)', () => {
  it('slot start is at the local wall-clock time and now is inside [start, next)', () => {
    const cairo = { ...utc, tz: 'Africa/Cairo' };
    for (const iso of ['2026-01-15T10:00:00Z', '2026-07-15T10:00:00Z', '2026-07-15T23:30:00Z']) {
      const now = new Date(iso);
      const s = currentSlot(now, cairo);
      const hm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
      expect(['08:00', '16:00']).toContain(hm(s.startedAt));
      expect(['08:00', '16:00']).toContain(hm(s.nextAt));
      expect(s.startedAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime()).toBeLessThan(s.nextAt.getTime());
    }
  });
});
