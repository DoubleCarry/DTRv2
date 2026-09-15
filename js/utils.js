/**
 * DTR — Utility / Helper Functions
 * Integrates with the central calcEngine.js module.
 */

import {
  PH_TIMEZONE,
  getManilaDateStr,
  isFutureDate,
  timeToMins as engineTimeToMins,
  minsToTime as engineMinsToTime,
  fmtHM as engineFmtHM,
  fmtHours as engineFmtHours,
  fmt12 as engineFmt12,
  fmtDate as engineFmtDate,
  calcRawDurationMins,
  calcLunchOverlapMins,
  calcEntryCreditedDuration,
  aggregateDayEntries,
  calcOjtTotals,
  predictCompletion,
  getPhilippineHolidays as engineGetPhilippineHolidays,
  isHolidayOrNonWorkingDay,
} from './calcEngine.js';

export {
  PH_TIMEZONE,
  getManilaDateStr,
  isFutureDate,
  calcRawDurationMins,
  calcLunchOverlapMins,
  calcEntryCreditedDuration,
  aggregateDayEntries,
  calcOjtTotals,
  predictCompletion,
  isHolidayOrNonWorkingDay,
};

export const fmtHM = engineFmtHM;
export const fmtHours = engineFmtHours;
export const fmt12 = engineFmt12;
export const fmtDate = engineFmtDate;
export const timeToMins = engineTimeToMins;
export const minsToTime = engineMinsToTime;
export const getPhilippineHolidays = engineGetPhilippineHolidays;

/** Today's date as "YYYY-MM-DD" in Asia/Manila */
export function todayStr() {
  return getManilaDateStr();
}

/** Current time as "HH:MM" */
export function nowTimeStr() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

export function calcLunchDeductionMins(timeIn, timeOut, lunchCfg) {
  return calcLunchOverlapMins(timeIn, timeOut, lunchCfg);
}

/**
 * Calculate hours between two "HH:MM" strings with overnight shift support.
 * Returns { totalMins, hours, overtime, overtimeMins, rawMins, lunchMins }
 */
export function calcHours(timeIn, timeOut, dailyStd = 8, lunchCfg = null) {
  if (!timeIn || !timeOut || timeIn === '--' || timeOut === '--') {
    return { totalMins: 0, hours: 0, overtime: 0, overtimeMins: 0, rawMins: 0, lunchMins: 0 };
  }
  const rawMins = calcRawDurationMins(timeIn, timeOut);
  const lunchMins = calcLunchOverlapMins(timeIn, timeOut, lunchCfg);
  const totalMins = Math.max(0, rawMins - lunchMins);
  const hours = Math.round((totalMins / 60) * 100) / 100;
  const stdMins = Math.round(dailyStd * 60);
  const overtimeMins = Math.max(0, totalMins - stdMins);
  const overtime = Math.round((overtimeMins / 60) * 100) / 100;
  return { totalMins, hours, overtime, overtimeMins, rawMins, lunchMins };
}

/** Aggregate session stats for a user using calcOjtTotals */
export function calcStats(sessions, goal, dailyHours = 8) {
  const formattedRecords = (sessions || []).map(s => ({
    ...s,
    workDate: s.date || s.workDate,
  }));
  const totals = calcOjtTotals(formattedRecords, goal, { dailyHours });
  const today = todayStr();
  let todayMins = 0;
  (sessions || []).forEach(s => {
    if ((s.date || s.workDate) === today) {
      todayMins += Math.round((s.hours || 0) * 60);
    }
  });

  return {
    totalMins: totals.totalCreditedMins,
    totalHours: totals.totalCreditedHours,
    overtimeMins: totals.overtimeMins,
    todayMins,
    remainMins: totals.remainingMins,
    pct: totals.progressPct,
  };
}

/** Format the live clock string */
export function fmtClock(d = new Date()) {
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh   = ((h % 12) || 12).toString().padStart(2, '0');
  const mm   = m.toString().padStart(2, '0');
  const ss   = s.toString().padStart(2, '0');
  return `${hh}:${mm}:${ss} ${ampm}`;
}

/** Clamp a number between min and max */
export function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }

/** Get first name from full name */
export function firstName(name) { return (name || '').split(' ')[0]; }

/** Build initial letter for avatar */
export function avatarLetter(name) { return (name || '?')[0].toUpperCase(); }

export function nextWeekday(date) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

export function predictCompletionDate(sessions, goalHours, options = {}) {
  const isNonWorkingDate = options.isNonWorkingDate || (dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 0 || d.getDay() === 6;
  });
  const logged = sessions.reduce((sum, s) => sum + (s.hours || 0), 0);
  const remaining = Math.max(0, goalHours - logged);
  if (remaining <= 0) return { label: 'Completed', sub: 'Goal already reached', date: todayStr(), avgPerDay: 0 };

  const workedDays = sessions.filter(s => !s.absent && (s.hours || 0) > 0);
  const uniqueDays = [...new Set(workedDays.map(s => s.date))];
  if (!uniqueDays.length) return { label: '—', sub: 'Need at least one worked day', date: null, avgPerDay: 0 };

  const avgPerDay = workedDays.reduce((sum, s) => sum + (s.hours || 0), 0) / uniqueDays.length;
  if (avgPerDay <= 0) return { label: '—', sub: 'Average hours unavailable', date: null, avgPerDay: 0 };

  const neededDays = Math.ceil(remaining / avgPerDay);
  let cursor = new Date(todayStr() + 'T00:00:00');
  let counted = 0;
  while (counted < neededDays) {
    cursor.setDate(cursor.getDate() + 1);
    const ds = cursor.toISOString().slice(0, 10);
    if (!isNonWorkingDate(ds)) counted++;
  }

  const dateStr = cursor.toISOString().slice(0, 10);
  return {
    label: fmtDate(dateStr),
    sub: `~${neededDays} work day${neededDays > 1 ? 's' : ''} at ${avgPerDay.toFixed(2)}h/day`,
    date: dateStr,
    avgPerDay,
  };
}

export function getHolidayLabel(dateStr, overrides = null) {
  if (!dateStr) return '';
  const addSet = new Set((overrides?.add || []).filter(Boolean));
  const removeSet = new Set((overrides?.remove || []).filter(Boolean));
  if (addSet.has(dateStr)) return 'Manual Holiday';
  if (removeSet.has(dateStr)) return '';
  const year = Number(dateStr.slice(0, 4));
  if (!year) return '';
  const holidays = getPhilippineHolidays(year);
  return holidays.get(dateStr) || '';
}

export function parseFlexibleTime(raw) {
  if (!raw) return null;
  const value = raw.trim().toUpperCase().replace(/\./g, '');
  const m = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = Number(m[2] || '0');
  const ap = m[3] || null;
  if (mm < 0 || mm > 59) return null;

  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'AM' && h === 12) h = 0;
    if (ap === 'PM' && h !== 12) h += 12;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function parseFlexibleDate(raw) {
  if (!raw) return null;
  const src = raw.trim();
  const iso = src.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const mdy = src.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (mdy) {
    const y = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return `${y}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  const d = new Date(src);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
