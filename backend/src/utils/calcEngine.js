/**
 * DTR Calculation Engine (Centralized)
 * Handles:
 * - Philippine timezone (Asia/Manila)
 * - Work interval calculation
 * - Overnight shifts
 * - Lunch break overlap deductions
 * - Multiple entries per day aggregation (regular hours vs overtime)
 * - Late & undertime calculations
 * - Fixed schedule & early arrival policy
 * - Completion tracking & surplus
 * - Completion forecasting considering holidays and schedule
 */

export const PH_TIMEZONE = 'Asia/Manila';

/**
 * Returns today's date in Asia/Manila as "YYYY-MM-DD"
 */
export function getManilaDateStr(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Validates whether a date string "YYYY-MM-DD" is in the future in Asia/Manila
 */
export function isFutureDate(dateStr) {
  if (!dateStr) return false;
  const today = getManilaDateStr();
  return dateStr > today;
}

/**
 * Converts "HH:MM" (24h) to total minutes from midnight (0..1439)
 */
export function timeToMins(time24) {
  if (!time24 || typeof time24 !== 'string') return 0;
  const [h, m] = time24.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Converts total minutes from midnight to "HH:MM" (24h)
 */
export function minsToTime(mins) {
  const safe = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Calculate raw duration in minutes between timeIn and timeOut,
 * correctly supporting overnight shifts (e.g. 22:00 -> 06:00 = 8h).
 */
export function calcRawDurationMins(timeIn, timeOut) {
  if (!timeIn || !timeOut || timeIn === '--' || timeOut === '--') return 0;
  const inM = timeToMins(timeIn);
  const outM = timeToMins(timeOut);
  if (outM < inM) {
    // Overnight shift crossing midnight
    return (1440 - inM) + outM;
  }
  return outM - inM;
}

/**
 * Calculates overlap in minutes between two intervals on a 24h cycle.
 * Handles overnight shifts if work interval wraps around midnight.
 */
export function calcLunchOverlapMins(timeIn, timeOut, lunchCfg) {
  if (!lunchCfg?.enabled) return 0;
  if (!lunchCfg.start || !lunchCfg.end) return 0;
  if (!timeIn || !timeOut || timeIn === '--' || timeOut === '--') return 0;

  const lunchStart = timeToMins(lunchCfg.start);
  const lunchEnd = timeToMins(lunchCfg.end);
  if (lunchEnd <= lunchStart) return 0; // standard lunch within single day

  const inM = timeToMins(timeIn);
  const outM = timeToMins(timeOut);

  // Helper for single non-wrapping interval overlap
  function singleOverlap(sA, eA, sB, eB) {
    const s = Math.max(sA, sB);
    const e = Math.min(eA, eB);
    return Math.max(0, e - s);
  }

  if (outM >= inM) {
    // Standard same-day work
    return singleOverlap(inM, outM, lunchStart, lunchEnd);
  } else {
    // Overnight shift: interval [inM, 1440] on day 1, and [0, outM] on day 2
    const day1Overlap = singleOverlap(inM, 1440, lunchStart, lunchEnd);
    const day2Overlap = singleOverlap(0, outM, lunchStart, lunchEnd);
    return day1Overlap + day2Overlap;
  }
}

/**
 * Calculates effective credited worked duration for a single entry,
 * taking into account lunch overlap and fixed schedule early arrival rules.
 */
export function calcEntryCreditedDuration(entry, userSettings = {}) {
  const { timeIn, timeOut } = entry;
  if (!timeIn || !timeOut || timeIn === '--' || timeOut === '--') {
    return { grossMins: 0, lunchDeductionMins: 0, creditedMins: 0, creditedHours: 0 };
  }

  let effectiveTimeIn = timeIn;
  const useFixedSchedule = Boolean(userSettings.useFixedSchedule);
  const earlyArrivalCountsAsOvertime = Boolean(userSettings.earlyArrivalCountsAsOvertime);

  // Early arrival handling: if fixed schedule is ON and early arrival does NOT count as OT,
  // clamp effective start to scheduled start if user arrived early.
  if (useFixedSchedule && !earlyArrivalCountsAsOvertime) {
    const schedStart = userSettings.scheduleStart || '08:00';
    const inM = timeToMins(timeIn);
    const schedStartM = timeToMins(schedStart);
    // If arriving earlier than schedule on same day start
    if (inM < schedStartM && inM >= (schedStartM - 360)) { // within 6 hours before
      effectiveTimeIn = schedStart;
    }
  }

  const grossMins = calcRawDurationMins(effectiveTimeIn, timeOut);
  const lunchCfg = userSettings.lunchBreak || { enabled: false };
  const lunchDeductionMins = calcLunchOverlapMins(effectiveTimeIn, timeOut, lunchCfg);
  const creditedMins = Math.max(0, grossMins - lunchDeductionMins);
  const creditedHours = Math.round((creditedMins / 60) * 100) / 100;

  return {
    grossMins,
    lunchDeductionMins,
    creditedMins,
    creditedHours,
    effectiveTimeIn,
  };
}

/**
 * Aggregates all entries for a specific date according to the user's settings.
 * Applies the 8-hour daily threshold to the AGGREGATED work time for that date,
 * and calculates late minutes and undertime minutes.
 */
export function aggregateDayEntries(dateStr, entries = [], userSettings = {}) {
  const dailyStandardHours = Number(userSettings.dailyHours ?? 8);
  const stdMins = Math.round(dailyStandardHours * 60);
  const useFixed = Boolean(userSettings.useFixedSchedule);
  const schedStart = userSettings.scheduleStart || '08:00';
  const schedEnd = userSettings.scheduleEnd || '17:00';

  // Sort entries chronologically by timeIn
  const activeEntries = entries
    .filter(e => !e.deletedAt && e.workDate === dateStr)
    .sort((a, b) => (a.timeIn || '').localeCompare(b.timeIn || ''));

  if (!activeEntries.length) {
    return {
      date: dateStr,
      entries: [],
      totalCreditedMins: 0,
      totalCreditedHours: 0,
      regularMins: 0,
      regularHours: 0,
      overtimeMins: 0,
      overtimeHours: 0,
      lateMinutes: 0,
      undertimeMinutes: 0,
    };
  }

  let totalCreditedMins = 0;
  const processedEntries = [];

  for (const entry of activeEntries) {
    const calc = calcEntryCreditedDuration(entry, userSettings);
    totalCreditedMins += calc.creditedMins;
    processedEntries.push({
      ...entry,
      creditedMins: calc.creditedMins,
      creditedHours: calc.creditedHours,
      lunchDeductionMins: calc.lunchDeductionMins,
    });
  }

  // Regular and Overtime calculated from day total
  const regularMins = Math.min(stdMins, totalCreditedMins);
  const overtimeMins = Math.max(0, totalCreditedMins - stdMins);
  const regularHours = Math.round((regularMins / 60) * 100) / 100;
  const overtimeHours = Math.round((overtimeMins / 60) * 100) / 100;
  const totalCreditedHours = Math.round((totalCreditedMins / 60) * 100) / 100;

  // Late calculation: based on earliest entry of the day vs scheduled start
  let lateMinutes = 0;
  if (useFixed && activeEntries.length > 0 && activeEntries[0].timeIn && activeEntries[0].timeIn !== '--') {
    const firstInM = timeToMins(activeEntries[0].timeIn);
    const schedStartM = timeToMins(schedStart);
    if (firstInM > schedStartM) {
      lateMinutes = firstInM - schedStartM;
    }
  }

  // Undertime calculation:
  // If scheduled standard hours not reached for this day
  let undertimeMinutes = 0;
  if (useFixed) {
    if (totalCreditedMins < stdMins) {
      undertimeMinutes = stdMins - totalCreditedMins;
    }
  }

  return {
    date: dateStr,
    entries: processedEntries,
    totalCreditedMins,
    totalCreditedHours,
    regularMins,
    regularHours,
    overtimeMins,
    overtimeHours,
    lateMinutes,
    undertimeMinutes,
  };
}

/**
 * Calculate totals and progress for an OJT Requirement across its DTR records.
 */
export function calcOjtTotals(records = [], targetHours = 300, userSettings = {}) {
  // Group records by workDate
  const byDate = new Map();
  for (const r of records) {
    if (r.deletedAt) continue;
    const d = r.workDate;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }

  let totalCreditedMins = 0;
  let regularMins = 0;
  let overtimeMins = 0;
  let lateMinutes = 0;
  let undertimeMinutes = 0;

  const dateSummaries = [];
  for (const [dateStr, dayEntries] of byDate.entries()) {
    const dayAgg = aggregateDayEntries(dateStr, dayEntries, userSettings);
    totalCreditedMins += dayAgg.totalCreditedMins;
    regularMins += dayAgg.regularMins;
    overtimeMins += dayAgg.overtimeMins;
    lateMinutes += dayAgg.lateMinutes;
    undertimeMinutes += dayAgg.undertimeMinutes;
    dateSummaries.push(dayAgg);
  }

  dateSummaries.sort((a, b) => b.date.localeCompare(a.date));

  const totalCreditedHours = Math.round((totalCreditedMins / 60) * 100) / 100;
  const regularHours = Math.round((regularMins / 60) * 100) / 100;
  const overtimeHours = Math.round((overtimeMins / 60) * 100) / 100;

  const targetMins = Math.round(Number(targetHours || 0) * 60);
  const remainingMins = Math.max(0, targetMins - totalCreditedMins);
  const remainingHours = Math.round((remainingMins / 60) * 100) / 100;
  const surplusMins = Math.max(0, totalCreditedMins - targetMins);
  const surplusHours = Math.round((surplusMins / 60) * 100) / 100;

  const progressPct = targetMins > 0 ? Math.min(100, Math.round((totalCreditedMins / targetMins) * 100)) : 100;
  const isCompleted = targetMins > 0 ? totalCreditedMins >= targetMins : false;

  return {
    totalCreditedMins,
    totalCreditedHours,
    regularMins,
    regularHours,
    overtimeMins,
    overtimeHours,
    lateMinutes,
    undertimeMinutes,
    targetHours: Number(targetHours),
    remainingMins,
    remainingHours,
    surplusMins,
    surplusHours,
    progressPct,
    isCompleted,
    uniqueDaysWorked: byDate.size,
    dateSummaries,
  };
}

/**
 * Philippine Holiday Engine
 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDateUtc(baseDateUtc, days) {
  const d = new Date(baseDateUtc);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const FIXED_PH_HOLIDAYS = [
  ['01-01', "New Year's Day"],
  ['04-09', 'Araw ng Kagitingan'],
  ['05-01', 'Labor Day'],
  ['06-12', 'Independence Day'],
  ['08-21', 'Ninoy Aquino Day'],
  ['11-01', "All Saints' Day"],
  ['11-30', 'Bonifacio Day'],
  ['12-08', 'Feast of the Immaculate Conception'],
  ['12-25', 'Christmas Day'],
  ['12-30', 'Rizal Day'],
];

function lastMondayOfAugust(year) {
  const d = new Date(Date.UTC(year, 7, 31));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function getPhilippineHolidays(year) {
  const map = new Map();
  FIXED_PH_HOLIDAYS.forEach(([md, name]) => map.set(`${year}-${md}`, name));
  map.set(lastMondayOfAugust(year), 'National Heroes Day');

  const easter = easterSunday(year);
  map.set(shiftDateUtc(easter, -3), 'Maundy Thursday');
  map.set(shiftDateUtc(easter, -2), 'Good Friday');
  map.set(shiftDateUtc(easter, -1), 'Black Saturday');
  return map;
}

export function isHolidayOrNonWorkingDay(dateStr, customHolidays = [], workingDays = [1, 2, 3, 4, 5]) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat

  // Check custom holidays first
  const custom = customHolidays.find(h => h.date === dateStr);
  if (custom) return { isNonWorking: true, name: custom.name };

  // Check system Philippine holidays
  const sysHolidays = getPhilippineHolidays(y);
  if (sysHolidays.has(dateStr)) {
    return { isNonWorking: true, name: sysHolidays.get(dateStr) };
  }

  // Check if configured working day
  if (!workingDays.includes(dayOfWeek)) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return { isNonWorking: true, name: `${dayNames[dayOfWeek]} (Non-working)` };
  }

  return { isNonWorking: false, name: '' };
}

/**
 * Completion Forecasting
 * Begins only after the user has logged at least one DTR entry.
 */
export function predictCompletion(records = [], targetHours = 300, userSettings = {}, customHolidays = []) {
  const activeRecords = records.filter(r => !r.deletedAt);
  if (!activeRecords.length) {
    return {
      canPredict: false,
      reason: 'Need at least one recorded DTR entry to calculate forecast',
      date: null,
      dateLabel: '—',
      remainingWorkDays: 0,
      avgDailyHours: 0,
    };
  }

  const totals = calcOjtTotals(activeRecords, targetHours, userSettings);
  if (totals.isCompleted) {
    return {
      canPredict: true,
      isCompleted: true,
      reason: 'Target hours reached',
      date: getManilaDateStr(),
      dateLabel: 'Completed',
      remainingWorkDays: 0,
      avgDailyHours: totals.uniqueDaysWorked > 0 ? totals.totalCreditedHours / totals.uniqueDaysWorked : 0,
    };
  }

  const remainingHours = totals.remainingHours;
  const daysWorked = totals.uniqueDaysWorked || 1;
  const avgDailyHours = totals.totalCreditedHours / daysWorked;
  if (avgDailyHours <= 0) {
    return {
      canPredict: false,
      reason: 'Average hours worked per day is zero',
      date: null,
      dateLabel: '—',
      remainingWorkDays: 0,
      avgDailyHours: 0,
    };
  }

  const neededWorkDays = Math.ceil(remainingHours / avgDailyHours);
  const workingDays = Array.isArray(userSettings.workingDays) && userSettings.workingDays.length
    ? userSettings.workingDays
    : [1, 2, 3, 4, 5];

  let current = new Date();
  // advance cursor day by day in Manila timezone
  let countedWorkDays = 0;
  let safetyLoop = 0;

  while (countedWorkDays < neededWorkDays && safetyLoop < 1000) {
    safetyLoop++;
    current.setDate(current.getDate() + 1);
    const dateStr = getManilaDateStr(current);
    const check = isHolidayOrNonWorkingDay(dateStr, customHolidays, workingDays);
    if (!check.isNonWorking) {
      countedWorkDays++;
    }
  }

  const predictedDate = getManilaDateStr(current);

  return {
    canPredict: true,
    isCompleted: false,
    date: predictedDate,
    dateLabel: predictedDate,
    remainingWorkDays: neededWorkDays,
    avgDailyHours: Math.round(avgDailyHours * 100) / 100,
  };
}
