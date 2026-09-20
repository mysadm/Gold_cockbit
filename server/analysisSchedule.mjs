const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DEFAULT_SCHEDULE = Object.freeze({ enabled: false, times: ['08:00', '16:00'], tz: 'Africa/Cairo', language: 'ar' });

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function normalizeSchedule(input) {
  const s = { ...DEFAULT_SCHEDULE, ...(input && typeof input === 'object' ? input : {}) };
  if (typeof s.enabled !== 'boolean') throw new Error('enabled must be true or false');
  if (!Array.isArray(s.times) || s.times.length < 1 || s.times.length > 4 || !s.times.every((t) => typeof t === 'string' && TIME_RE.test(t))) {
    throw new Error('times must be 1 to 4 values in HH:MM (24-hour) format');
  }
  if (typeof s.tz !== 'string' || !validTimeZone(s.tz)) throw new Error('tz must be a valid IANA time zone, e.g. Africa/Cairo');
  if (!['ar', 'en'].includes(s.language)) throw new Error("language must be 'ar' or 'en'");
  return { enabled: s.enabled, times: [...new Set(s.times)].sort(), tz: s.tz, language: s.language };
}

function zonedParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

// UTC instant of a wall-clock time in `tz`; two correction passes absorb DST offset changes.
function zonedToUtc(y, m, d, h, min, tz) {
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    guess -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - target;
  }
  return new Date(guess);
}

const pad = (n) => String(n).padStart(2, '0');
function shiftDay(y, m, d, delta) {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function currentSlot(now, schedule) {
  const { tz, times } = schedule;
  const local = zonedParts(now, tz);
  const nowHm = `${pad(local.h)}:${pad(local.min)}`;
  const past = times.filter((t) => t <= nowHm);
  const slotTime = past.length ? past[past.length - 1] : times[times.length - 1];
  const slotDay = past.length ? { y: local.y, m: local.m, d: local.d } : shiftDay(local.y, local.m, local.d, -1);
  const later = times.filter((t) => t > nowHm);
  const nextTime = later.length ? later[0] : times[0];
  const nextDay = later.length ? { y: local.y, m: local.m, d: local.d } : shiftDay(local.y, local.m, local.d, 1);
  const at = (day, hm) => { const [h, min] = hm.split(':').map(Number); return zonedToUtc(day.y, day.m, day.d, h, min, tz); };
  return {
    key: `${slotDay.y}-${pad(slotDay.m)}-${pad(slotDay.d)}@${slotTime}`,
    startedAt: at(slotDay, slotTime),
    nextAt: at(nextDay, nextTime),
  };
}
