import type { AnalysisSchedule } from '../api/sharedAnalysis';

// The editable shape of the schedule panel. Only the first two times are edited;
// any further times the server holds are carried through untouched on save.
export type ScheduleForm = {
  enabled: boolean;
  time1: string;
  time2: string;
  tz: string;
  language: 'ar' | 'en';
  extraTimes: string[];
};

export function scheduleToForm(s: AnalysisSchedule): ScheduleForm {
  return {
    enabled: s.enabled,
    time1: s.times[0] ?? '',
    time2: s.times[1] ?? '',
    tz: s.tz,
    language: s.language,
    extraTimes: s.times.slice(2),
  };
}

export function formToSchedule(f: ScheduleForm): AnalysisSchedule {
  return {
    enabled: f.enabled,
    times: [f.time1, f.time2].filter((t) => t !== '').concat(f.extraTimes),
    tz: f.tz.trim(),
    language: f.language,
  };
}

function sameSchedule(a: AnalysisSchedule, b: AnalysisSchedule): boolean {
  return a.enabled === b.enabled
    && a.tz === b.tz
    && a.language === b.language
    && a.times.length === b.times.length
    && a.times.every((t, i) => t === b.times[i]);
}

// True when the form differs from the schedule last loaded or saved.
export function isScheduleChanged(form: ScheduleForm, loaded: AnalysisSchedule): boolean {
  return !sameSchedule(formToSchedule(form), loaded);
}

// Save needs at least one time and a timezone; the server still owns full validation.
export function isScheduleSubmittable(form: ScheduleForm): boolean {
  const s = formToSchedule(form);
  return s.times.length > 0 && s.tz !== '';
}
