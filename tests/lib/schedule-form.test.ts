import { describe, it, expect } from 'vitest';
import type { AnalysisSchedule } from '../../src/api/sharedAnalysis';
import {
  formToSchedule, isScheduleChanged, isScheduleSubmittable, scheduleToForm,
} from '../../src/lib/scheduleForm';

const base: AnalysisSchedule = { enabled: true, times: ['08:00', '20:00'], tz: 'Africa/Cairo', language: 'ar' };

describe('scheduleToForm / formToSchedule', () => {
  it('round-trips a schedule unchanged', () => {
    expect(scheduleToForm(base)).toEqual({
      enabled: true, time1: '08:00', time2: '20:00', tz: 'Africa/Cairo', language: 'ar', extraTimes: [],
    });
    expect(formToSchedule(scheduleToForm(base))).toEqual(base);
  });

  it('carries times beyond the first two through untouched', () => {
    const s = { ...base, times: ['08:00', '12:00', '20:00'] };
    const form = scheduleToForm(s);
    expect(form.extraTimes).toEqual(['20:00']);
    expect(formToSchedule({ ...form, time2: '13:30' }).times).toEqual(['08:00', '13:30', '20:00']);
  });

  it('drops a cleared time and trims the timezone', () => {
    const form = { ...scheduleToForm(base), time2: '', tz: '  UTC ' };
    expect(formToSchedule(form)).toEqual({ enabled: true, times: ['08:00'], tz: 'UTC', language: 'ar' });
  });

  it('handles a schedule with a single time', () => {
    const form = scheduleToForm({ ...base, times: ['09:00'] });
    expect(form.time2).toBe('');
    expect(formToSchedule(form).times).toEqual(['09:00']);
  });
});

describe('isScheduleChanged', () => {
  it('is false for an untouched form and true for each edited field', () => {
    const form = scheduleToForm(base);
    expect(isScheduleChanged(form, base)).toBe(false);
    expect(isScheduleChanged({ ...form, enabled: false }, base)).toBe(true);
    expect(isScheduleChanged({ ...form, time1: '09:00' }, base)).toBe(true);
    expect(isScheduleChanged({ ...form, time2: '' }, base)).toBe(true);
    expect(isScheduleChanged({ ...form, tz: 'UTC' }, base)).toBe(true);
    expect(isScheduleChanged({ ...form, language: 'en' }, base)).toBe(true);
  });

  it('ignores whitespace around an otherwise unchanged timezone', () => {
    expect(isScheduleChanged({ ...scheduleToForm(base), tz: 'Africa/Cairo ' }, base)).toBe(false);
  });

  it('is false again after an edit is reverted', () => {
    const form = scheduleToForm(base);
    expect(isScheduleChanged({ ...form, time1: '09:00' }, base)).toBe(true);
    expect(isScheduleChanged({ ...form, time1: '08:00' }, base)).toBe(false);
  });
});

describe('isScheduleSubmittable', () => {
  it('needs at least one time and a timezone', () => {
    const form = scheduleToForm(base);
    expect(isScheduleSubmittable(form)).toBe(true);
    expect(isScheduleSubmittable({ ...form, time1: '', time2: '' })).toBe(false);
    expect(isScheduleSubmittable({ ...form, time1: '' })).toBe(true);
    expect(isScheduleSubmittable({ ...form, tz: '   ' })).toBe(false);
  });
});
