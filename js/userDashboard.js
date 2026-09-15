/**
 * DTR — User Dashboard Module
 */

import {
  getUser, getSessions, setSessions, removeSession,
  clearSessions, saveUser, getCurrentUser, setCurrentUser, uid, migrateUserId, getUsers,
} from './storage.js';
import {
  fmtHM, fmtHours, fmt12, fmtDate, todayStr, firstName,
  getHolidayLabel, parseFlexibleDate, parseFlexibleTime,
  timeToMins, minsToTime,
} from './utils.js';
import {
  calcRawDurationMins,
  calcLunchOverlapMins,
  calcEntryCreditedDuration,
  aggregateDayEntries,
  calcOjtTotals,
  predictCompletion,
  isFutureDate,
} from './calcEngine.js';
import { toast, openModal, closeModal, setProgressRing, setTopbarUser, val, setVal, setText, renderThemeTemplatesGrid, getColorTheme, applyColorTheme } from './ui.js';
import { exportCSV, exportPrint } from './export.js';
import {
  apiListDTR, apiCreateDTR, apiUpdateDTR, apiDeleteDTR, apiClearDTR,
  apiCheckDuplicates, apiBulkImportDTR,
  apiListOJTs, apiCreateOJT, apiUpdateOJT, apiActivateOJT, apiDeleteOJT,
  apiUpdateSettings,
  apiListSessions, apiCreateSession, apiUpdateSession, apiDeleteSession, apiClearSessions,
} from './api.js';

let _editingEntryId = null;
let _importPreview = [];
let _activeOjt = null;
let _allOjts = [];

function apiSessionToLocal(s) {
  const d = s.workDate || s.date || '';
  return {
    id: String(s._id || s.id || uid()),
    date: d,
    workDate: d,
    timeIn: s.timeIn ?? '--',
    timeOut: s.timeOut ?? '--',
    hours: Number(s.hours ?? 0),
    overtime: Number(s.overtime ?? 0),
    source: s.source || 'manual',
    note: s.note || '',
    absent: !!s.absent || (!s.timeIn || s.timeIn === '--'),
    late: !!s.late,
    undertime: !!s.undertime,
    ojtRequirementId: s.ojtRequirementId || null,
  };
}

function currentUserFresh() {
  const user = getCurrentUser();
  if (!user) return null;
  return getUser(user.id) || user;
}

function getLunchCfg(user) {
  const cfg = user?.settings?.lunchBreak || user?.lunchBreak;
  if (cfg) {
    return {
      enabled: cfg.enabled !== false,
      start: cfg.start || '12:00',
      end: cfg.end || '13:00',
    };
  }
  return { enabled: true, start: '12:00', end: '13:00' };
}

function overtimeEnabled(user) {
  return user?.overtimeEnabled !== false;
}

function lateTrackingEnabled(user) {
  return user?.settings?.useFixedSchedule === true || user?.lateTrackingEnabled === true || user?.useFixedSchedule === true;
}

function workSchedule(user) {
  return {
    start: user?.settings?.scheduleStart || user?.scheduleStart || '08:00',
    end: user?.settings?.scheduleEnd || user?.scheduleEnd || '17:00',
  };
}

function getUserSettings(user) {
  return {
    dailyHours: user?.settings?.dailyHours || user?.dailyHours || 8,
    useFixedSchedule: lateTrackingEnabled(user),
    scheduleStart: user?.settings?.scheduleStart || user?.scheduleStart || '08:00',
    scheduleEnd: user?.settings?.scheduleEnd || user?.scheduleEnd || '17:00',
    earlyArrivalCountsAsOvertime: user?.settings?.earlyArrivalCountsAsOvertime ?? user?.earlyArrivalCountsAsOvertime ?? false,
    lunchBreak: getLunchCfg(user),
  };
}

function holidayOverrides(user) {
  return {
    add: Array.isArray(user?.manualHolidaysAdd) ? user.manualHolidaysAdd : [],
    remove: Array.isArray(user?.manualHolidaysRemove) ? user.manualHolidaysRemove : [],
  };
}

function isNonWorkingDateForUser(dateStr, user) {
  const d = new Date(dateStr + 'T00:00:00');
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const holiday = getHolidayLabel(dateStr, holidayOverrides(user));
  return weekend || !!holiday;
}

function parseDateList(raw) {
  if (!raw) return [];
  const parts = raw.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
  const clean = parts.filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
  return [...new Set(clean)].sort();
}

function isLateEntry(entry, user) {
  if (!lateTrackingEnabled(user)) return false;
  if (!entry || entry.absent || !entry.timeIn || entry.timeIn === '--') return false;
  const sched = workSchedule(user);
  return timeToMins(entry.timeIn) > timeToMins(sched.start);
}

function isUndertimeEntry(entry, user) {
  if (!lateTrackingEnabled(user)) return false;
  if (!entry || entry.absent || !entry.timeOut || entry.timeOut === '--') return false;
  const sched = workSchedule(user);
  return timeToMins(entry.timeOut) < timeToMins(sched.end);
}

/* ─── OJT REQUIREMENTS ─── */
export async function loadOJTs() {
  try {
    const { ojts } = await apiListOJTs();
    if (Array.isArray(ojts) && ojts.length > 0) {
      _allOjts = ojts;
      const active = ojts.find(o => o.status === 'ACTIVE') || ojts[0];
      _activeOjt = active;
      renderActiveOjtBadge();
    }
  } catch (err) {
    console.warn('OJT fetch fallback:', err);
  }
}

function renderActiveOjtBadge() {
  const u = currentUserFresh();
  const name = _activeOjt?.name || 'Standard OJT';
  const target = _activeOjt?.targetHours || u?.goal || 300;
  setText('activeOjtTitle', name);
  setText('activeOjtTargetHrs', target);
}

export function openOjtModal() {
  renderOjtList();
  setVal('newOjtName', '');
  setVal('newOjtTargetHours', '300');
  setVal('newOjtStartDate', todayStr());
  openModal('ojtModal');
}

function renderOjtList() {
  const listEl = document.getElementById('ojtList');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!_allOjts.length) {
    listEl.innerHTML = '<div style="color:var(--text3);font-size:0.8rem;padding:0.5rem 0;">No OJT requirements found yet.</div>';
    return;
  }
  _allOjts.forEach(o => {
    const isActive = _activeOjt && String(_activeOjt._id || _activeOjt.id) === String(o._id || o.id);
    const item = document.createElement('div');
    item.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;background:${isActive ? 'var(--card-bg-active, #f0fdf4)' : 'var(--card-bg)'};`;
    item.innerHTML = `
      <div>
        <div style="font-weight:600;font-size:0.875rem;">${o.name} ${isActive ? '<span class="badge badge-green" style="margin-left:0.4rem;">ACTIVE</span>' : ''}</div>
        <div style="font-size:0.75rem;color:var(--text3);">Target: ${o.targetHours}h · Start: ${fmtDate(o.startDate)}</div>
      </div>
      <div>
        ${!isActive ? `<button class="btn btn-secondary btn-sm" onclick="window.dtr.handleActivateOJT('${o._id || o.id}')">Set Active</button>` : '<span style="font-size:0.75rem;color:var(--success, #16a34a);font-weight:600;">Current</span>'}
      </div>
    `;
    listEl.appendChild(item);
  });
}

export async function handleCreateOJT() {
  const name = val('newOjtName').trim();
  const targetHours = Number(val('newOjtTargetHours'));
  const startDate = val('newOjtStartDate') || todayStr();
  if (!name) { toast('OJT Name is required.', 'error'); return; }
  if (!targetHours || targetHours < 1) { toast('Target hours must be at least 1.', 'error'); return; }

  try {
    await apiCreateOJT({ name, targetHours, startDate, status: 'ACTIVE' });
    toast(`Created OJT requirement: ${name}`, 'success');
    await loadOJTs();
    closeModal('ojtModal');
    refresh();
  } catch (err) {
    toast(err.message || 'Failed to create OJT requirement.', 'error');
  }
}

export async function handleActivateOJT(ojtId) {
  try {
    await apiActivateOJT(ojtId);
    toast('Switched active OJT requirement.', 'success');
    await loadOJTs();
    renderOjtList();
    refresh();
  } catch (err) {
    toast(err.message || 'Failed to activate OJT.', 'error');
  }
}

function recalcEntry(entry, user) {
  if (entry.absent || !entry.timeIn || entry.timeIn === '--' || !entry.timeOut || entry.timeOut === '--') {
    return { ...entry, timeIn: '--', timeOut: '--', hours: 0, overtime: 0, late: false, undertime: false, source: entry.source || 'manual' };
  }
  const userSettings = getUserSettings(user);
  const calc = calcEntryCreditedDuration({ timeIn: entry.timeIn, timeOut: entry.timeOut }, userSettings);
  return {
    ...entry,
    hours: calc.creditedHours,
    overtime: entry.overtime || 0,
    late: isLateEntry(entry, user),
    undertime: isUndertimeEntry(entry, user),
  };
}

function recalcAllSessions(user) {
  const sessions = getSessions(user.id);
  const userSettings = getUserSettings(user);
  const targetHours = _activeOjt?.targetHours || user.goal || 300;
  const totals = calcOjtTotals(sessions.map(s => ({ ...s, workDate: s.date })), targetHours, userSettings);

  const byDate = new Map();
  totals.dateSummaries.forEach(day => byDate.set(day.date, day));

  const updated = sessions.map(s => {
    const daySummary = byDate.get(s.date);
    const dayOt = daySummary ? daySummary.overtimeHours : 0;
    return {
      ...recalcEntry(s, user),
      overtime: dayOt,
    };
  });

  setSessions(user.id, updated);
  return updated;
}

function buildTimeFromPicker(prefix) {
  const hour = Number(val(`${prefix}Hour`));
  const minute = Number(val(`${prefix}Minute`));
  const ampm = val(`${prefix}Meridiem`);
  if (!hour || Number.isNaN(minute) || !ampm) return '';
  let h24 = hour % 12;
  if (ampm === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function syncPickerFromTime(prefix, time24, defaults = { hour: '08', minute: '00', meridiem: 'AM' }) {
  if (!time24 || time24 === '--') {
    setVal(`${prefix}Hour`, defaults.hour);
    setVal(`${prefix}Minute`, defaults.minute);
    setVal(`${prefix}Meridiem`, defaults.meridiem);
    return;
  }
  const mins = timeToMins(time24);
  const h24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = (h24 % 12) || 12;
  setVal(`${prefix}Hour`, String(hour12).padStart(2, '0'));
  setVal(`${prefix}Minute`, String(mm).padStart(2, '0'));
  setVal(`${prefix}Meridiem`, ampm);
}

function setNativeTime(prefix, time24) {
  setVal(`${prefix}Time`, time24);
}

function wirePicker(prefix, onChange) {
  [`${prefix}Hour`, `${prefix}Minute`, `${prefix}Meridiem`].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      const time24 = buildTimeFromPicker(prefix);
      setNativeTime(prefix, time24);
      onChange?.();
    });
  });
}

function readEntryTimes() {
  const timeIn = buildTimeFromPicker('entryIn');
  const timeOut = buildTimeFromPicker('entryOut');
  setNativeTime('entryIn', timeIn);
  setNativeTime('entryOut', timeOut);
  return { timeIn, timeOut };
}

function readEditTimes() {
  const timeIn = buildTimeFromPicker('editIn');
  const timeOut = buildTimeFromPicker('editOut');
  setNativeTime('editIn', timeIn);
  setNativeTime('editOut', timeOut);
  return { timeIn, timeOut };
}

export function fillMinuteSelect(id) {
  const el = document.getElementById(id);
  if (!el || el.options.length) return;
  const html = [];
  for (let i = 0; i < 60; i++) {
    const mm = String(i).padStart(2, '0');
    html.push(`<option value="${mm}">${mm}</option>`);
  }
  el.innerHTML = html.join('');
}

export function addWheelBehavior(id, onChange) {
  const el = document.getElementById(id);
  if (!el || el.dataset.wheelBound === '1') return;
  el.dataset.wheelBound = '1';
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const len = el.options.length;
    if (!len) return;
    const next = (el.selectedIndex + dir + len) % len;
    el.selectedIndex = next;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    onChange?.();
  }, { passive: false });
}

function setEntryAbsentUI(isAbsent) {
  document.getElementById('entryTimeFields')?.classList.toggle('hidden', isAbsent);
  document.getElementById('entryAbsentNote')?.classList.toggle('hidden', !isAbsent);
}

/* ─── INIT ─── */
export function initUserDashboard() {
  const user = currentUserFresh();
  if (!user) return;

  [
    'entryInMinute', 'entryOutMinute',
    'editInMinute', 'editOutMinute',
    'scheduleStartMinute', 'scheduleEndMinute',
    'lunchStartMinute', 'lunchEndMinute',
  ].forEach(fillMinuteSelect);

  [
    'entryInHour','entryInMinute','entryInMeridiem',
    'entryOutHour','entryOutMinute','entryOutMeridiem',
    'editInHour','editInMinute','editInMeridiem',
    'editOutHour','editOutMinute','editOutMeridiem',
    'scheduleStartHour','scheduleStartMinute','scheduleStartMeridiem',
    'scheduleEndHour','scheduleEndMinute','scheduleEndMeridiem',
    'lunchStartHour','lunchStartMinute','lunchStartMeridiem',
    'lunchEndHour','lunchEndMinute','lunchEndMeridiem',
  ].forEach(id => addWheelBehavior(id));

  setText('userGreetName', firstName(user.name));
  const now = new Date();
  setText('userGreetDate', now.toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }));

  setTodayDate();
  const absentEl = document.getElementById('entryAbsent');
  if (absentEl) absentEl.checked = false;
  setEntryAbsentUI(false);

  const sched = workSchedule(user);
  syncPickerFromTime('entryIn', sched.start || '08:00');
  syncPickerFromTime('entryOut', sched.end || '17:00');
  setNativeTime('entryIn', sched.start || '08:00');
  setNativeTime('entryOut', sched.end || '17:00');

  wirePicker('entryIn', updateEntryPreview);
  wirePicker('entryOut', updateEntryPreview);
  wirePicker('editIn', updateEditOvertimePreview);
  wirePicker('editOut', updateEditOvertimePreview);

  ['entryDate', 'entryNote', 'entryAbsent'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateEntryPreview);
  });

  loadOJTs().then(() => {
    apiListDTR().then(({ records, ojt }) => {
      if (ojt) _activeOjt = ojt;
      const u = currentUserFresh();
      if (u && Array.isArray(records)) {
        setSessions(u.id, records.map(apiSessionToLocal));
      }
      refresh();
    }).catch(() => {
      refresh();
    });
  });
}

/* ─── REFRESH ALL ─── */
export function refresh() {
  const user = getCurrentUser();
  if (!user) return;
  const freshUser = getUser(user.id) || user;

  const sessions = getSessions(freshUser.id);
  const targetGoal = _activeOjt?.targetHours || freshUser.goal || 300;
  const userSettings = getUserSettings(freshUser);

  // Compute using central calculation engine
  const totals = calcOjtTotals(sessions.map(s => ({ ...s, workDate: s.date })), targetGoal, userSettings);
  const forecast = predictCompletion(sessions.map(s => ({ ...s, workDate: s.date })), targetGoal, userSettings, []);

  // Sync date overtime attributions into sessions for display
  const byDate = new Map();
  totals.dateSummaries.forEach(day => byDate.set(day.date, day));
  sessions.forEach(s => {
    const day = byDate.get(s.date);
    if (day) {
      s.overtime = day.overtimeHours;
    }
  });

  const attendance = sessions.filter(s => !s.absent && (s.hours || 0) > 0).length;
  const absence = sessions.filter(s => !!s.absent).length;
  const attendanceRate = sessions.length ? Math.round((attendance / sessions.length) * 100) : 0;
  const schedule = workSchedule(freshUser);
  const lateCount = lateTrackingEnabled(freshUser)
    ? sessions.filter(s => (typeof s.late === 'boolean' ? s.late : isLateEntry(s, freshUser))).length
    : 0;
  const undertimeCount = lateTrackingEnabled(freshUser)
    ? sessions.filter(s => (typeof s.undertime === 'boolean' ? s.undertime : isUndertimeEntry(s, freshUser))).length
    : 0;

  setProgressRing(totals.progressPct);

  setText('ringStat_logged', fmtHM(totals.totalCreditedMins));
  setText('ringStat_remaining', fmtHM(totals.remainingMins));
  setText('ringStat_overtime', fmtHM(totals.overtimeMins));

  renderActiveOjtBadge();
  setText('statGoal', targetGoal + 'h');
  setText('statDays', sessions.length);
  setText('statAttendance', attendance);
  setText('statAbsence', absence);
  setText('statAttendanceContext', `${attendanceRate}% attendance rate`);
  setText('statLate', lateCount);
  setText('statLateSub', lateTrackingEnabled(freshUser) ? `Late after ${fmt12(schedule.start)} · Undertime before ${fmt12(schedule.end)}` : 'Fixed schedule off');
  setText('statUndertime', undertimeCount);

  const deadline = deadlineStatus(freshUser, { label: forecast.dateLabel, date: forecast.date, sub: forecast.reason || '' }, sessions);
  setText('statStatus', deadline.label);
  setText('statStatusSub', deadline.sub);
  setText('statPredictDate', forecast.canPredict ? forecast.dateLabel : '—');
  setText('statPredictSub', forecast.canPredict
    ? (forecast.isCompleted ? 'Target hours reached!' : `~${forecast.remainingWorkDays} work days remaining at ${forecast.avgDailyHours}h/day`)
    : (forecast.reason || 'Need at least one entry'));

  const upcoming = upcomingCountedHolidays(freshUser);
  const upcomingEl = document.getElementById('statUpcomingHolidays');
  if (upcomingEl) {
    if (upcoming.length) {
      upcomingEl.textContent = `Upcoming holidays:\n${upcoming.map(h => `${fmtDate(h.date)} (${h.label})`).join('\n')}`;
    } else {
      upcomingEl.textContent = 'Upcoming holidays: none';
    }
  }

  const statusEl = document.getElementById('statStatus');
  if (statusEl) {
    statusEl.className = 'stat-card-value ' +
      (totals.progressPct >= 100 ? 'green' : totals.progressPct >= 75 ? 'blue' : totals.progressPct >= 40 ? '' : 'yellow');
  }

  renderHistoryTable(sessions, freshUser.dailyHours || 8);
}

function statusLabel(pct) {
  if (pct >= 100) return '🎉 Complete';
  if (pct >= 75) return '🔥 Near Goal';
  if (pct >= 40) return '✅ On Track';
  return '⏳ In Progress';
}

function workdaysBetween(fromDate, toDate, user) {
  const start = new Date(fromDate + 'T00:00:00');
  const end = new Date(toDate + 'T00:00:00');
  if (end <= start) return 0;
  let days = 0;
  const cur = new Date(start);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const ds = cur.toISOString().slice(0, 10);
    if (!isNonWorkingDateForUser(ds, user)) days++;
  }
  return days;
}

function upcomingCountedHolidays(user, options = {}) {
  const maxItems = options.maxItems || 4;
  const horizonDays = options.horizonDays || 120;
  const target = user?.targetDate || '';
  const endDate = target || (() => {
    const d = new Date(todayStr() + 'T00:00:00');
    d.setDate(d.getDate() + horizonDays);
    return d.toISOString().slice(0, 10);
  })();
  const out = [];
  const cur = new Date(todayStr() + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (cur <= end && out.length < maxItems) {
    const ds = cur.toISOString().slice(0, 10);
    const label = getHolidayLabel(ds, holidayOverrides(user));
    if (label) out.push({ date: ds, label });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function deadlineStatus(user, predicted, sessions) {
  const target = user.targetDate || '';
  const totalLogged = sessions.reduce((sum, s) => sum + (s.hours || 0), 0);
  const goal = _activeOjt?.targetHours || user.goal || 300;
  const pct = Math.min(100, Math.round((totalLogged / goal) * 100));
  if (!target) return { label: statusLabel(pct), sub: 'Set target date for deadline check' };
  if (!predicted?.date) return { label: '⏳ In Progress', sub: `Target ${fmtDate(target)} · Need work history` };
  if (predicted.date <= target) return { label: '✅ Safe', sub: `On track for ${fmtDate(target)}` };

  const remaining = Math.max(0, goal - totalLogged);
  const leftDays = workdaysBetween(todayStr(), target, user);
  if (leftDays <= 0) return { label: '⚠ Will not finish before target', sub: `Target ${fmtDate(target)} has passed or is today` };
  const needPerDay = remaining / leftDays;
  if (needPerDay > (user.dailyHours || 8)) {
    return { label: '⚠ Will not finish before target', sub: `Need ${needPerDay.toFixed(2)}h/day by ${fmtDate(target)}` };
  }
  return { label: '⚠ Need overtime', sub: `Need ~${needPerDay.toFixed(2)}h/day by ${fmtDate(target)}` };
}

export function setTodayDate() {
  setVal('entryDate', todayStr());
}

export function setMeridiem(which, value) {
  if (which === 'in') setVal('entryInMeridiem', value);
  if (which === 'out') setVal('entryOutMeridiem', value);
  const { timeIn, timeOut } = readEntryTimes();
  if (timeIn) setNativeTime('entryIn', timeIn);
  if (timeOut) setNativeTime('entryOut', timeOut);
  updateEntryPreview();
}

export function setEditMeridiem(which, value) {
  if (which === 'in') setVal('editInMeridiem', value);
  if (which === 'out') setVal('editOutMeridiem', value);
  const { timeIn, timeOut } = readEditTimes();
  if (timeIn) setNativeTime('editIn', timeIn);
  if (timeOut) setNativeTime('editOut', timeOut);
  updateEditOvertimePreview();
}

export function toggleEntryAbsent() {
  const isAbsent = document.getElementById('entryAbsent')?.checked || false;
  setEntryAbsentUI(isAbsent);
  updateEntryPreview();
}

function updateEntryPreview() {
  const absent = document.getElementById('entryAbsent')?.checked || false;
  const preview = document.getElementById('overtimePreview');
  const previewText = document.getElementById('overtimePreviewText');
  if (absent) {
    preview?.classList.remove('show');
    return;
  }

  const { timeIn, timeOut } = readEntryTimes();
  const user = currentUserFresh();
  if (!user || !timeIn || !timeOut) { preview?.classList.remove('show'); return; }

  const rawMins = calcRawDurationMins(timeIn, timeOut);
  if (rawMins === 0) {
    preview?.classList.remove('show');
    return;
  }

  const isOvernight = timeToMins(timeOut) < timeToMins(timeIn);
  const userSettings = getUserSettings(user);
  const calc = calcEntryCreditedDuration({ timeIn, timeOut }, userSettings);
  const daily = user.dailyHours || 8;
  const stdMins = daily * 60;
  const otMins = Math.max(0, calc.creditedMins - stdMins);

  const parts = [];
  if (isOvernight) parts.push('🌙 Overnight shift (+1 day)');
  parts.push(`${fmtHM(calc.creditedMins)} credited`);

  if (calc.lunchDeductionMins > 0) {
    parts.push(`(${fmtHM(calc.lunchDeductionMins)} lunch deducted)`);
  }
  if (otMins > 0 && overtimeEnabled(user)) {
    parts.push(`· +${fmtHM(otMins)} overtime`);
  }

  if (preview && previewText) {
    previewText.textContent = parts.join(' ');
    preview.classList.add('show');
  }
}

/* ─── ADD MANUAL ENTRY ─── */
export function handleAddEntry() {
  const date = val('entryDate');
  const note = val('entryNote').trim();
  const absent = document.getElementById('entryAbsent')?.checked || false;

  if (!date) { toast('Please select a date.', 'error'); return; }
  if (isFutureDate(date)) {
    toast('Cannot log entries for future dates (Asia/Manila time).', 'error');
    return;
  }

  const user = currentUserFresh();
  if (!user) return;

  let entry;
  if (absent) {
    entry = {
      id: uid(),
      date,
      workDate: date,
      timeIn: '--',
      timeOut: '--',
      hours: 0,
      overtime: 0,
      source: 'manual',
      absent: true,
      note: note || 'Absent',
      ojtRequirementId: _activeOjt?._id || _activeOjt?.id || null,
    };
  } else {
    const { timeIn, timeOut } = readEntryTimes();
    if (!timeIn) { toast('Please enter Time In.', 'error'); return; }
    if (!timeOut) { toast('Please enter Time Out.', 'error'); return; }

    const rawMins = calcRawDurationMins(timeIn, timeOut);
    if (rawMins === 0) { toast('Time In and Time Out cannot be the same.', 'error'); return; }

    const userSettings = getUserSettings(user);
    const calc = calcEntryCreditedDuration({ timeIn, timeOut }, userSettings);
    const isOvernight = timeToMins(timeOut) < timeToMins(timeIn);

    entry = {
      id: uid(),
      date,
      workDate: date,
      timeIn,
      timeOut,
      hours: calc.creditedHours,
      overtime: 0,
      late: isLateEntry({ date, timeIn, absent: false }, user),
      undertime: isUndertimeEntry({ date, timeOut, absent: false }, user),
      source: 'manual',
      absent: false,
      note,
      ojtRequirementId: _activeOjt?._id || _activeOjt?.id || null,
    };

    const overnightNotice = isOvernight ? ' (Overnight)' : '';
    toast(`Added ${fmtHM(calc.creditedMins)}${overnightNotice} for ${fmtDate(date)}`, 'success');
  }

  const sessions = getSessions(user.id);
  sessions.push(entry);
  setSessions(user.id, sessions);

  apiCreateDTR({
    workDate: date,
    timeIn: entry.timeIn,
    timeOut: entry.timeOut,
    note: entry.note,
    source: 'manual',
    ojtRequirementId: _activeOjt?._id || _activeOjt?.id || undefined,
  }).then(({ record }) => {
    if (record) {
      const latest = getSessions(user.id).map(s => (s.id === entry.id ? apiSessionToLocal(record) : s));
      setSessions(user.id, latest);
      refresh();
    }
  }).catch(() => {});

  if (absent) toast(`Marked ${fmtDate(date)} as absent.`, 'info');

  setTodayDate();
  setVal('entryNote', '');
  const absentEl = document.getElementById('entryAbsent');
  if (absentEl) absentEl.checked = false;
  setEntryAbsentUI(false);
  const freshUser = currentUserFresh();
  const sched = workSchedule(freshUser);
  syncPickerFromTime('entryIn', sched.start || '08:00');
  syncPickerFromTime('entryOut', sched.end || '17:00');
  setNativeTime('entryIn', sched.start || '08:00');
  setNativeTime('entryOut', sched.end || '17:00');
  updateEntryPreview();
  refresh();
}

export function openEditEntry(entryId) {
  const user = getCurrentUser();
  const sessions = getSessions(user.id);
  const entry = sessions.find(s => s.id === entryId);
  if (!entry) { toast('Entry not found.', 'error'); return; }

  _editingEntryId = entryId;
  setVal('editEntryDate', entry.date);
  setVal('editEntryNote', entry.note || '');
  const editAbsentEl = document.getElementById('editEntryAbsent');
  if (editAbsentEl) editAbsentEl.checked = !!entry.absent;
  toggleEditAbsent();

  syncPickerFromTime('editIn', entry.timeIn === '--' ? '08:00' : entry.timeIn, { hour: '08', minute: '00', meridiem: 'AM' });
  syncPickerFromTime('editOut', entry.timeOut === '--' ? '17:00' : entry.timeOut, { hour: '05', minute: '00', meridiem: 'PM' });
  readEditTimes();
  updateEditOvertimePreview();
  openModal('editEntryModal');
}

function toggleEditAbsent() {
  const absent = document.getElementById('editEntryAbsent')?.checked || false;
  document.getElementById('editTimeFields')?.classList.toggle('hidden', absent);
}

export function updateEditOvertimePreview() {
  const preview = document.getElementById('editOvertimePreview');
  const previewText = document.getElementById('editOvertimePreviewText');
  const absent = document.getElementById('editEntryAbsent')?.checked || false;
  if (absent) { preview?.classList.remove('show'); return; }

  const { timeIn, timeOut } = readEditTimes();
  const user = currentUserFresh();
  if (!user || !timeIn || !timeOut) { preview?.classList.remove('show'); return; }

  const rawMins = calcRawDurationMins(timeIn, timeOut);
  if (rawMins === 0) {
    preview?.classList.remove('show');
    return;
  }

  const isOvernight = timeToMins(timeOut) < timeToMins(timeIn);
  const userSettings = getUserSettings(user);
  const calc = calcEntryCreditedDuration({ timeIn, timeOut }, userSettings);
  const daily = user.dailyHours || 8;
  const stdMins = daily * 60;
  const otMins = Math.max(0, calc.creditedMins - stdMins);

  const parts = [];
  if (isOvernight) parts.push('🌙 Overnight shift (+1 day)');
  parts.push(`${fmtHM(calc.creditedMins)} credited`);

  if (calc.lunchDeductionMins > 0) {
    parts.push(`(${fmtHM(calc.lunchDeductionMins)} lunch deducted)`);
  }
  if (otMins > 0 && overtimeEnabled(user)) {
    parts.push(`· +${fmtHM(otMins)} overtime`);
  }

  if (preview && previewText) {
    previewText.textContent = parts.join(' ');
    preview.classList.add('show');
  }
}

export function saveEditEntry() {
  const entryId = _editingEntryId;
  if (!entryId) { toast('No entry selected.', 'error'); return; }

  const date = val('editEntryDate');
  const note = val('editEntryNote').trim();
  const absent = document.getElementById('editEntryAbsent')?.checked || false;
  if (!date) { toast('Please select a date.', 'error'); return; }
  if (isFutureDate(date)) {
    toast('Cannot log entries for future dates (Asia/Manila time).', 'error');
    return;
  }

  const user = currentUserFresh();
  const sessions = getSessions(user.id);
  const idx = sessions.findIndex(s => s.id === entryId);
  if (idx === -1) { toast('Entry not found.', 'error'); return; }

  if (absent) {
    sessions[idx] = {
      ...sessions[idx],
      date,
      workDate: date,
      timeIn: '--',
      timeOut: '--',
      hours: 0,
      overtime: 0,
      absent: true,
      note: note || 'Absent',
    };
  } else {
    const { timeIn, timeOut } = readEditTimes();
    if (!timeIn || !timeOut) { toast('Please provide both Time In and Time Out.', 'error'); return; }
    const rawMins = calcRawDurationMins(timeIn, timeOut);
    if (rawMins === 0) { toast('Time In and Time Out cannot be the same.', 'error'); return; }

    const userSettings = getUserSettings(user);
    const calc = calcEntryCreditedDuration({ timeIn, timeOut }, userSettings);

    sessions[idx] = {
      ...sessions[idx],
      date,
      workDate: date,
      timeIn,
      timeOut,
      hours: calc.creditedHours,
      late: isLateEntry({ ...sessions[idx], date, timeIn, absent: false }, user),
      undertime: isUndertimeEntry({ ...sessions[idx], date, timeOut, absent: false }, user),
      absent: false,
      note,
    };
  }

  setSessions(user.id, sessions);
  apiUpdateDTR(entryId, {
    workDate: sessions[idx].date,
    timeIn: sessions[idx].timeIn,
    timeOut: sessions[idx].timeOut,
    note: sessions[idx].note,
  }).catch(() => {});

  closeModal('editEntryModal');
  _editingEntryId = null;
  toast('Entry updated.', 'success');
  refresh();
}

export async function deleteEntry(entryId) {
  const { confirm } = await import('./ui.js');
  const ok = await confirm('Delete Entry', 'Remove this time record? This cannot be undone.', 'Delete', 'btn-danger');
  if (!ok) return;
  const user = getCurrentUser();
  removeSession(user.id, entryId);
  apiDeleteDTR(entryId).catch(() => {});
  toast('Entry removed.', 'info');
  refresh();
}

export async function clearAll() {
  const { confirm } = await import('./ui.js');
  const ok = await confirm('Clear All Records', 'This will permanently delete ALL time records for your account.', 'Clear All', 'btn-danger');
  if (!ok) return;
  const user = getCurrentUser();
  clearSessions(user.id);
  apiClearDTR({ ojtId: _activeOjt?._id || _activeOjt?.id }).catch(() => {});
  toast('All records cleared.', 'info');
  refresh();
}

export function updateConfigAccessibility() {
  const lateEnabled = document.getElementById('settingLateEnabled')?.checked ?? false;
  const lunchEnabled = document.getElementById('settingLunchEnabled')?.checked ?? false;

  const schedGroup = document.getElementById('scheduleConfigGroup');
  if (schedGroup) {
    schedGroup.classList.toggle('config-group-disabled', !lateEnabled);
    schedGroup.querySelectorAll('select, input').forEach(el => {
      el.disabled = !lateEnabled;
    });
  }

  const lunchGroup = document.getElementById('lunchConfigGroup');
  if (lunchGroup) {
    lunchGroup.classList.toggle('config-group-disabled', !lunchEnabled);
    lunchGroup.querySelectorAll('select, input').forEach(el => {
      el.disabled = !lunchEnabled;
    });
  }
}

export function openSettings() {
  const user = currentUserFresh();
  if (!user) return;

  // Always ensure minute pickers are populated
  [
    'scheduleStartMinute', 'scheduleEndMinute',
    'lunchStartMinute', 'lunchEndMinute',
  ].forEach(fillMinuteSelect);

  [
    'scheduleStartHour', 'scheduleStartMinute', 'scheduleStartMeridiem',
    'scheduleEndHour', 'scheduleEndMinute', 'scheduleEndMeridiem',
    'lunchStartHour', 'lunchStartMinute', 'lunchStartMeridiem',
    'lunchEndHour', 'lunchEndMinute', 'lunchEndMeridiem',
  ].forEach(id => addWheelBehavior(id));

  setVal('settingGoal', user.goal || 300);
  setVal('settingTargetDate', user.targetDate || '');
  setVal('settingDaily', user.dailyHours || 8);
  setVal('settingName', user.name || '');
  setVal('settingUsername', user.username || user.id || '');
  const overtimeEl = document.getElementById('settingOvertimeEnabled');
  if (overtimeEl) overtimeEl.checked = overtimeEnabled(user);
  const lateEl = document.getElementById('settingLateEnabled');
  if (lateEl) lateEl.checked = lateTrackingEnabled(user);
  const sched = workSchedule(user);
  syncPickerFromTime('scheduleStart', sched.start, { hour: '08', minute: '00', meridiem: 'AM' });
  syncPickerFromTime('scheduleEnd', sched.end, { hour: '05', minute: '00', meridiem: 'PM' });
  const lunch = getLunchCfg(user);
  const lunchEnabled = document.getElementById('settingLunchEnabled');
  if (lunchEnabled) lunchEnabled.checked = lunch.enabled === true;
  syncPickerFromTime('lunchStart', lunch.start || '12:00', { hour: '12', minute: '00', meridiem: 'PM' });
  syncPickerFromTime('lunchEnd', lunch.end || '13:00', { hour: '01', minute: '00', meridiem: 'PM' });
  setVal('settingHolidayAdd', (holidayOverrides(user).add || []).join('\n'));
  setVal('settingHolidayRemove', (holidayOverrides(user).remove || []).join('\n'));
  setVal('settingCurrentPassword', '');
  setVal('settingNewPassword', '');
  setVal('settingConfirmPassword', '');

  // Render theme selection cards and ensure disabled config options are greyed out & non-clickable
  renderThemeTemplatesGrid();
  updateConfigAccessibility();

  openModal('settingsModal');
}

export function saveSettings() {
  const goal = parseFloat(val('settingGoal'));
  const targetDate = val('settingTargetDate');
  const daily = parseFloat(val('settingDaily'));
  const name = val('settingName').trim();
  const username = val('settingUsername').trim().toLowerCase();
  const overtimeOn = document.getElementById('settingOvertimeEnabled')?.checked ?? true;
  const lateOn = document.getElementById('settingLateEnabled')?.checked ?? false;
  const scheduleStart = buildTimeFromPicker('scheduleStart') || '08:00';
  const scheduleEnd = buildTimeFromPicker('scheduleEnd') || '17:00';
  const lunchEnabled = Boolean(document.getElementById('settingLunchEnabled')?.checked);
  let lunchStart = buildTimeFromPicker('lunchStart') || '12:00';
  let lunchEnd = buildTimeFromPicker('lunchEnd') || '13:00';
  const holidayAdd = parseDateList(val('settingHolidayAdd'));
  const holidayRemove = parseDateList(val('settingHolidayRemove'));
  const currentPass = val('settingCurrentPassword');
  const newPass = val('settingNewPassword');
  const confirmPass = val('settingConfirmPassword');

  if (!goal || goal < 1) { toast('Goal must be at least 1 hour.', 'error'); return; }
  if (!daily || daily < 1) { toast('Daily hours must be at least 1.', 'error'); return; }
  if (!username) { toast('Username is required.', 'error'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { toast('Username must use lowercase letters, numbers, or underscore.', 'error'); return; }
  if (lateOn && (!scheduleStart || !scheduleEnd || timeToMins(scheduleEnd) <= timeToMins(scheduleStart))) {
    toast('Work schedule must have a valid start and end time.', 'error');
    return;
  }
  if (lunchEnabled && (!lunchStart || !lunchEnd || timeToMins(lunchEnd) <= timeToMins(lunchStart))) {
    const sM = timeToMins(lunchStart || '12:00');
    const eM = (sM + 60) % 1440;
    const h24 = Math.floor(eM / 60);
    const mm = eM % 60;
    lunchEnd = `${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    syncPickerFromTime('lunchEnd', lunchEnd);
  }

  const user = getCurrentUser();
  const fresh = getUser(user.id) || user;
  if (newPass || confirmPass || currentPass) {
    if (!currentPass) { toast('Enter current password to change it.', 'error'); return; }
    if (!newPass || newPass.length < 4) { toast('New password must be at least 4 characters.', 'error'); return; }
    if (newPass !== confirmPass) { toast('New passwords do not match.', 'error'); return; }
  }

  const lunchBreakConfig = {
    enabled: lunchEnabled,
    start: lunchStart,
    end: lunchEnd,
  };

  const updated = {
    ...fresh,
    goal,
    targetDate: targetDate || '',
    dailyHours: daily,
    overtimeEnabled: overtimeOn,
    lateTrackingEnabled: lateOn,
    useFixedSchedule: lateOn,
    scheduleStart,
    scheduleEnd,
    manualHolidaysAdd: holidayAdd,
    manualHolidaysRemove: holidayRemove,
    name: name || fresh.name,
    username,
    password: newPass ? newPass : fresh.password,
    colorTheme: getColorTheme(),
    lunchBreak: lunchBreakConfig,
    settings: {
      ...(fresh.settings || {}),
      dailyHours: daily,
      useFixedSchedule: lateOn,
      scheduleStart,
      scheduleEnd,
      lunchBreak: lunchBreakConfig,
    },
  };

  let activeUser = updated;
  const currentUsername = fresh.username || fresh.id;
  if (username !== currentUsername) {
    const users = getUsers();
    const isTaken = Object.values(users).some(u => 
      (u.username === username || u.id === username) && u.id !== fresh.id && u._id !== fresh.id
    );
    if (isTaken) { toast('That username is already taken.', 'error'); return; }
    const migrated = migrateUserId(fresh.id, username);
    if (!migrated) {
      activeUser = { ...updated, username };
    } else {
      activeUser = { ...updated, id: username, username };
    }
  }

  saveUser(activeUser);
  setCurrentUser(activeUser);
  const apiPayload = {
    name: activeUser.name,
    username: activeUser.username,
    goal: activeUser.goal,
    targetDate: activeUser.targetDate,
    dailyHours: activeUser.dailyHours,
    overtimeEnabled: activeUser.overtimeEnabled,
    lateTrackingEnabled: activeUser.lateTrackingEnabled,
    useFixedSchedule: activeUser.lateTrackingEnabled,
    scheduleStart: activeUser.scheduleStart,
    scheduleEnd: activeUser.scheduleEnd,
    lunchBreak: activeUser.lunchBreak,
    manualHolidaysAdd: activeUser.manualHolidaysAdd,
    manualHolidaysRemove: activeUser.manualHolidaysRemove,
    exportProfile: activeUser.exportProfile || {},
    currentPassword: currentPass || undefined,
    newPassword: newPass || undefined,
    confirmPassword: confirmPass || undefined,
  };
  apiUpdateSettings(apiPayload).then(({ user: apiUser }) => {
    if (apiUser) {
      if (!apiUser.lunchBreak && activeUser.lunchBreak) {
        apiUser.lunchBreak = activeUser.lunchBreak;
      }
      if (!apiUser.settings) apiUser.settings = {};
      if (!apiUser.settings.lunchBreak && activeUser.lunchBreak) {
        apiUser.settings.lunchBreak = activeUser.lunchBreak;
      }
      saveUser(apiUser);
      setCurrentUser(apiUser);
      setTopbarUser(apiUser);
      setText('userGreetName', firstName(apiUser.name));
      const savedSched = workSchedule(apiUser);
      syncPickerFromTime('entryIn', savedSched.start || '08:00');
      syncPickerFromTime('entryOut', savedSched.end || '17:00');
      setNativeTime('entryIn', savedSched.start || '08:00');
      setNativeTime('entryOut', savedSched.end || '17:00');
      updateEntryPreview();
      recalcAllSessions(apiUser);
      refresh();
    }
  }).catch((err) => {
    console.warn('apiUpdateSettings fallback:', err);
  });
  recalcAllSessions(activeUser);
  setTopbarUser(activeUser);
  setText('userGreetName', firstName(activeUser.name));

  // Also update entry pickers immediately with the new schedule
  const savedSched = workSchedule(activeUser);
  syncPickerFromTime('entryIn', savedSched.start || '08:00');
  syncPickerFromTime('entryOut', savedSched.end || '17:00');
  setNativeTime('entryIn', savedSched.start || '08:00');
  setNativeTime('entryOut', savedSched.end || '17:00');
  updateEntryPreview();

  closeModal('settingsModal');
  toast('Settings saved.', 'success');
  refresh();
}

/* ─── IMPORT ─── */
function parseDtrText(raw) {
  function splitDelimitedLine(line, delimiter = ',') {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (ch === delimiter && !q) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  function cleanDateCell(v) {
    return String(v || '')
      .replace(/^"+|"+$/g, '')
      .replace(/\s*\([^)]*\)\s*$/g, '')
      .trim();
  }

  function cleanCell(v) {
    return String(v || '').replace(/^"+|"+$/g, '').trim();
  }

  function parseTimeToken(rawToken) {
    const token = cleanCell(rawToken).toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (!token) return null;
    let normalized = token;
    const hhmm = token.match(/^(\d{1,2})(\d{2})$/);
    if (hhmm) normalized = `${hhmm[1]}:${hhmm[2]}`;
    const hHmm = token.match(/^(\d{1,2})H(\d{2})$/);
    if (hHmm) normalized = `${hHmm[1]}:${hHmm[2]}`;
    return parseFlexibleTime(normalized);
  }

  function parseLabeledTimes(line) {
    const inMatch = line.match(/\b(?:time\s*in|in)\s*[:=]\s*([0-9]{1,2}(?::?[0-9]{2})?\s*(?:AM|PM)?)\b/i);
    const outMatch = line.match(/\b(?:time\s*out|out)\s*[:=]\s*([0-9]{1,2}(?::?[0-9]{2})?\s*(?:AM|PM)?)\b/i);
    if (!inMatch || !outMatch) return null;
    const tIn = parseTimeToken(inMatch[1]);
    const tOut = parseTimeToken(outMatch[1]);
    if (!tIn || !tOut) return null;
    if (timeToMins(tOut) <= timeToMins(tIn)) return null;
    return { tIn, tOut };
  }

  function parseDelimitedRow(line) {
    const delim = line.includes('\t') ? '\t' : (line.includes('|') ? '|' : (line.includes(';') ? ';' : ','));
    const cells = splitDelimitedLine(line, delim).map(cleanCell).filter(v => v !== '');
    if (cells.length < 3) return null;

    let date = null;
    for (const c of cells) {
      const parsed = parseFlexibleDate(cleanDateCell(c));
      if (parsed) { date = parsed; break; }
    }
    if (!date) return null;

    const whole = cells.join(' ');
    const absent = /\b(absent|no work|nowork|leave)\b/i.test(whole);
    if (absent) {
      return { date, timeIn: '--', timeOut: '--', absent: true, note: 'Imported absent', source: 'import' };
    }

    const labeled = parseLabeledTimes(whole);
    if (labeled) {
      return { date, timeIn: labeled.tIn, timeOut: labeled.tOut, absent: false, note: 'Imported from structured text', source: 'import' };
    }

    const timeCandidates = whole.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b|\b\d{1,2}\s*(?:AM|PM)\b|\b\d{3,4}\b/gi) || [];
    const parsedTimes = timeCandidates.map(parseTimeToken).filter(Boolean);
    if (parsedTimes.length < 2) return null;
    const tIn = parsedTimes[0];
    const tOut = parsedTimes[1];
    if (timeToMins(tOut) <= timeToMins(tIn)) return null;
    return { date, timeIn: tIn, timeOut: tOut, absent: false, note: 'Imported from table text', source: 'import' };
  }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (/[,|\t;]/.test(line)) {
      const structured = parseDelimitedRow(line);
      if (structured) {
        rows.push(structured);
        continue;
      }
    }

    const dateMatch = line.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/);
    if (!dateMatch) continue;
    const date = parseFlexibleDate(cleanDateCell(dateMatch[1]));
    if (!date) continue;

    const absent = /\b(absent|no work|nowork|leave)\b/i.test(line);
    if (absent) {
      rows.push({ date, timeIn: '--', timeOut: '--', absent: true, note: 'Imported absent', source: 'import' });
      continue;
    }

    const labeled = parseLabeledTimes(line);
    if (labeled) {
      rows.push({ date, timeIn: labeled.tIn, timeOut: labeled.tOut, absent: false, note: 'Imported from labeled text', source: 'import' });
      continue;
    }

    const withoutDate = line.replace(dateMatch[1], ' ');
    const times = withoutDate.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b|\b\d{1,2}\s*(?:AM|PM)\b|\b\d{3,4}\b/gi) || [];
    const parsedTimes = times.map(parseTimeToken).filter(Boolean);
    if (parsedTimes.length < 2) continue;
    const tIn = parsedTimes[0];
    const tOut = parsedTimes[1];
    if (!tIn || !tOut) continue;
    if (timeToMins(tOut) <= timeToMins(tIn)) continue;
    rows.push({ date, timeIn: tIn, timeOut: tOut, absent: false, note: 'Imported from text', source: 'import' });
  }
  return rows;
}

function looksLikeDuplicate(targetSessions, row) {
  return targetSessions.some(s =>
    s.date === row.date &&
    (s.absent ? '--' : s.timeIn) === (row.absent ? '--' : row.timeIn) &&
    (s.absent ? '--' : s.timeOut) === (row.absent ? '--' : row.timeOut),
  );
}

function renderImportPreview(items) {
  const tbody = document.getElementById('importPreviewTbody');
  const empty = document.getElementById('importPreviewEmpty');
  if (!tbody || !empty) return;
  tbody.innerHTML = '';
  if (!items.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  items.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${fmtDate(row.date)}</td>
      <td>${row.absent ? 'Absent' : fmt12(row.timeIn)}</td>
      <td>${row.absent ? '—' : fmt12(row.timeOut)}</td>
      <td>${row.note || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

export function openImportModal() {
  _importPreview = [];
  setVal('importText', '');
  const fileInput = document.getElementById('importFile');
  if (fileInput) fileInput.value = '';
  renderImportPreview([]);
  openModal('importModal');
}

export function handleImportFileSelect(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    setVal('importText', text);
    toast(`Loaded file: ${file.name}`, 'success');
  };
  reader.onerror = () => {
    toast('Failed to read selected file.', 'error');
  };
  reader.readAsText(file);
}

export function previewImport() {
  const raw = val('importText');
  if (!raw.trim()) { toast('Paste DTR text first.', 'warning'); return; }
  _importPreview = parseDtrText(raw);
  renderImportPreview(_importPreview);
  if (!_importPreview.length) toast('No valid entries detected.', 'warning');
  else toast(`Detected ${_importPreview.length} entries.`, 'success');
}

export async function importParsedEntries() {
  if (!_importPreview.length) { toast('No parsed entries to import.', 'warning'); return; }
  const user = currentUserFresh();
  if (!user) return;
  const sessions = getSessions(user.id);
  const strategy = document.getElementById('importDuplicateStrategy')?.value || 'skip';
  const userSettings = getUserSettings(user);

  const rawEntries = _importPreview.map(row => {
    if (row.absent) {
      return {
        id: uid(),
        date: row.date,
        workDate: row.date,
        timeIn: '--',
        timeOut: '--',
        hours: 0,
        overtime: 0,
        source: 'import',
        absent: true,
        note: row.note || 'Imported absent',
        ojtRequirementId: _activeOjt?._id || _activeOjt?.id || null,
      };
    }
    const calc = calcEntryCreditedDuration({ timeIn: row.timeIn, timeOut: row.timeOut }, userSettings);
    return {
      id: uid(),
      date: row.date,
      workDate: row.date,
      timeIn: row.timeIn,
      timeOut: row.timeOut,
      hours: calc.creditedHours,
      overtime: 0,
      late: isLateEntry({ ...row, absent: false }, user),
      undertime: isUndertimeEntry({ ...row, absent: false }, user),
      source: 'import',
      absent: false,
      note: row.note || '',
      ojtRequirementId: _activeOjt?._id || _activeOjt?.id || null,
    };
  });

  // Local deduplication logic based on chosen strategy
  let finalSessions = [...sessions];
  let importedCount = 0;

  if (strategy === 'append') {
    finalSessions = [...sessions, ...rawEntries];
    importedCount = rawEntries.length;
  } else if (strategy === 'overwrite') {
    rawEntries.forEach(incoming => {
      const matchIdx = finalSessions.findIndex(s => s.date === incoming.date);
      if (matchIdx >= 0) {
        finalSessions[matchIdx] = incoming;
      } else {
        finalSessions.push(incoming);
      }
      importedCount++;
    });
  } else {
    // default 'skip'
    rawEntries.forEach(incoming => {
      const exists = looksLikeDuplicate(finalSessions, incoming);
      if (!exists) {
        finalSessions.push(incoming);
        importedCount++;
      }
    });
  }

  setSessions(user.id, finalSessions);

  // Sync to API backend
  try {
    const apiPayload = {
      entries: rawEntries.map(e => ({
        workDate: e.date,
        timeIn: e.timeIn,
        timeOut: e.timeOut,
        note: e.note,
        absent: e.absent,
        source: 'import',
      })),
      duplicateStrategy: strategy,
      ojtRequirementId: _activeOjt?._id || _activeOjt?.id || undefined,
    };
    const res = await apiBulkImportDTR(apiPayload);
    if (res?.records && Array.isArray(res.records)) {
      const remote = await apiListDTR({ ojtId: _activeOjt?._id || _activeOjt?.id });
      if (remote?.records) {
        setSessions(user.id, remote.records.map(apiSessionToLocal));
      }
    }
  } catch (err) {
    console.warn('Remote bulk import fallback to local sessions:', err);
  }

  closeModal('importModal');
  toast(`Imported ${importedCount} entries (strategy: ${strategy}).`, 'success');
  refresh();
}

/* ─── EXPORT ─── */
export function openExportModal() {
  const user = currentUserFresh();
  const p = user?.exportProfile || {};
  setVal('exportTemplateType', p.templateType || 'quick');
  setVal('exportTitle', p.title || '');
  setVal('exportLogoUrl', p.logoUrl || '');
  setVal('exportOrganization', p.organization || '');
  setVal('exportStudentName', p.studentName || user?.name || '');
  setVal('exportStudentId', p.studentId || '');
  setVal('exportProgram', p.program || '');
  setVal('exportDetails', p.details || '');
  setVal('exportCustomTemplate', p.customTemplate || '');
  setExportAdditionalInfoRows(Array.isArray(p.additionalInfo) ? p.additionalInfo : []);
  updateExportTemplateUI();
  openModal('exportModal');
}

function exportAdditionalListEl() {
  return document.getElementById('exportAdditionalInfoList');
}

function createAdditionalInfoRow(item = {}) {
  const row = document.createElement('div');
  row.className = 'export-additional-row';
  row.innerHTML = `
    <input class="input-field export-add-title" placeholder="Title (e.g. Supervisor)" value="${(item.title || '').replace(/"/g, '&quot;')}">
    <input class="input-field export-add-value" placeholder="Value (e.g. Juan Dela Cruz)" value="${(item.value || '').replace(/"/g, '&quot;')}">
    <button type="button" class="btn btn-ghost btn-sm">Remove</button>
  `;
  row.querySelector('button')?.addEventListener('click', () => row.remove());
  return row;
}

function setExportAdditionalInfoRows(items = []) {
  const list = exportAdditionalListEl();
  if (!list) return;
  list.innerHTML = '';
  const safeItems = items.filter(it => (it?.title || '').trim() || (it?.value || '').trim());
  (safeItems.length ? safeItems : [{}]).forEach(item => list.appendChild(createAdditionalInfoRow(item)));
}

export function addExportAdditionalInfoRow() {
  const list = exportAdditionalListEl();
  if (!list) return;
  list.appendChild(createAdditionalInfoRow({}));
}

function readExportAdditionalInfoRows() {
  const list = exportAdditionalListEl();
  if (!list) return [];
  return [...list.querySelectorAll('.export-additional-row')].map(row => ({
    title: row.querySelector('.export-add-title')?.value?.trim() || '',
    value: row.querySelector('.export-add-value')?.value?.trim() || '',
  })).filter(it => it.title || it.value);
}

export function updateExportTemplateUI() {
  const type = val('exportTemplateType') || 'quick';
  const metaWrap = document.getElementById('exportMetaFields');
  const customWrap = document.getElementById('exportCustomTemplateWrap');
  if (metaWrap) metaWrap.classList.toggle('hidden', type === 'quick');
  if (customWrap) customWrap.classList.toggle('hidden', type !== 'custom');
  if (type === 'university') {
    if (!val('exportTitle')) setVal('exportTitle', 'University OJT Daily Time Record');
  } else if (type === 'quick' && val('exportTitle').includes('Daily Time Record')) {
    setVal('exportTitle', '');
  }
}

function readExportOptions(freshUser) {
  const profile = freshUser.exportProfile || {};
  const additionalInfo = readExportAdditionalInfoRows();
  const resolvedMeta = {
    title: val('exportTitle').trim() || profile.title || '',
    logoUrl: val('exportLogoUrl').trim() || profile.logoUrl || '',
    organization: val('exportOrganization').trim() || profile.organization || '',
    studentName: val('exportStudentName').trim() || profile.studentName || freshUser.name,
    studentId: val('exportStudentId').trim() || profile.studentId || '',
    program: val('exportProgram').trim() || profile.program || '',
    additionalInfo: additionalInfo.length ? additionalInfo : (Array.isArray(profile.additionalInfo) ? profile.additionalInfo : []),
    details: val('exportDetails').trim() || profile.details || '',
  };
  const customTemplate = val('exportCustomTemplate').trim() || profile.customTemplate || '';
  const templateType = val('exportTemplateType') || profile.templateType || 'quick';
  const updated = {
    ...freshUser,
    exportProfile: {
      ...profile,
      templateType,
      ...resolvedMeta,
      customTemplate,
    },
  };
  saveUser(updated);
  setCurrentUser(updated);
  return {
    templateType,
    meta: resolvedMeta,
    customTemplate,
  };
}

export function doExportCSV() {
  const user = getCurrentUser();
  const fresh = getUser(user.id) || user;
  const sessions = getSessions(user.id);
  if (!sessions.length) { toast('No records to export.', 'warning'); return; }
  exportCSV(fresh, sessions);
  closeModal('exportModal');
  toast('CSV downloaded!', 'success');
}

export function doExportPrint() {
  const user = getCurrentUser();
  const fresh = getUser(user.id) || user;
  const sessions = getSessions(user.id);
  if (!sessions.length) { toast('No records to export.', 'warning'); return; }
  const options = readExportOptions(fresh);
  if (options.templateType === 'custom' && !options.customTemplate) {
    toast('Please provide a custom HTML template.', 'warning');
    return;
  }
  exportPrint(fresh, sessions, options);
  closeModal('exportModal');
}

/* ─── RENDER TABLE ─── */
export function renderHistoryTable(sessions, dailyHours = 8, tbodyId = 'historyTbody', emptyId = 'historyEmpty', userForHolidays = null) {
  const tbody = document.getElementById(tbodyId);
  const empty = document.getElementById(emptyId);
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!sessions.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach((s, i) => {
    const hrs = parseFloat(s.hours) || 0;
    const ot = parseFloat(s.overtime) || 0;
    const isOT = ot > 0;
    const h = Math.floor(hrs);
    const m = Math.round((hrs - h) * 60);
    const otH = Math.floor(ot);
    const otM = Math.round((ot - otH) * 60);
    const holidayUser = userForHolidays || currentUserFresh();
    const holiday = getHolidayLabel(s.date, holidayOverrides(holidayUser));

    const tr = document.createElement('tr');
    if (isOT) tr.classList.add('row-overtime');

    const sourceMark = s.source === 'import' ? '📥' : s.source === 'punch' ? '🟢' : '✏️';
    const tags = [];
    if (s.late) tags.push('<span class="badge badge-red">Late</span>');
    if (s.undertime) tags.push('<span class="badge badge-yellow">Undertime</span>');
    const note = [s.note || '', tags.join(' ')].filter(Boolean).join(' ').trim() || '—';

    tr.innerHTML = `
      <td class="mono" style="color:var(--text3);font-size:0.72rem">${sorted.length - i}</td>
      <td class="td-main">
        ${fmtDate(s.date)}
        ${holiday ? `<div class="holiday-flag" title="${holiday}">🇵🇭 ${holiday}</div>` : ''}
      </td>
      <td>${s.absent ? 'Absent' : fmt12(s.timeIn)}</td>
      <td>${s.absent ? '—' : fmt12(s.timeOut)}</td>
      <td class="td-num">${s.absent ? '0h 0m' : `${h}h ${m}m`}</td>
      <td>${isOT ? `<span class="badge badge-purple"><span class="badge-dot"></span>+${otH}h ${otM}m</span>` : '<span class="badge badge-neutral">—</span>'}</td>
      <td style="color:var(--text3);font-size:0.75rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;">${note}</td>
      <td style="color:var(--text3);font-size:0.7rem">${sourceMark}</td>
      ${tbodyId === 'historyTbody'
        ? `<td style="display:flex;gap:0.4rem;"><button class="btn btn-secondary btn-sm" onclick="window.dtr.openEditEntry('${s.id}')">✎</button><button class="btn btn-danger btn-sm" onclick="window.dtr.deleteEntry('${s.id}')">✕</button></td>`
        : ''}
    `;
    tbody.appendChild(tr);
  });
}

window.addEventListener('change', e => {
  if (e.target?.id === 'editEntryAbsent') toggleEditAbsent();
  if (e.target?.id === 'editInMeridiem') setEditMeridiem('in', e.target.value);
  if (e.target?.id === 'editOutMeridiem') setEditMeridiem('out', e.target.value);
});

