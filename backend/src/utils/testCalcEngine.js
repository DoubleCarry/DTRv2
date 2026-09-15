import {
  aggregateDayEntries,
  calcRawDurationMins,
  calcOjtTotals,
  isFutureDate,
  getManilaDateStr,
} from './calcEngine.js';

console.log('--- RUNNING DTR CALCULATION ENGINE VERIFICATION ---');

let failed = 0;
function assert(desc, condition, actual, expected) {
  if (condition) {
    console.log(`[PASS] ${desc}`);
  } else {
    console.error(`[FAIL] ${desc} | Expected: ${JSON.stringify(expected)} | Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// 1. Normal shift: 08:00 -> 17:00, Lunch 12:00 -> 13:00 => 8h regular, 0 OT
{
  const entries = [{ workDate: '2026-09-10', timeIn: '08:00', timeOut: '17:00' }];
  const settings = {
    dailyHours: 8,
    lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
  };
  const res = aggregateDayEntries('2026-09-10', entries, settings);
  assert('Normal shift: 8h regular, 0 OT', res.regularHours === 8 && res.overtimeHours === 0 && res.totalCreditedHours === 8, res, { regular: 8, ot: 0, total: 8 });
}

// 2. Overtime: 08:30 -> 18:30, Lunch 12:30 -> 13:30 => 9h total, 8h regular, 1h OT
{
  const entries = [{ workDate: '2026-09-10', timeIn: '08:30', timeOut: '18:30' }];
  const settings = {
    dailyHours: 8,
    lunchBreak: { enabled: true, start: '12:30', end: '13:30' },
  };
  const res = aggregateDayEntries('2026-09-10', entries, settings);
  assert('Overtime shift: 9h total, 8h regular, 1h OT', res.totalCreditedHours === 9 && res.regularHours === 8 && res.overtimeHours === 1, res, { regular: 8, ot: 1, total: 9 });
}

// 3. Late: Schedule 08:00, Time In 08:15 => 15m late
{
  const entries = [{ workDate: '2026-09-10', timeIn: '08:15', timeOut: '17:00' }];
  const settings = {
    dailyHours: 8,
    useFixedSchedule: true,
    scheduleStart: '08:00',
    scheduleEnd: '17:00',
    lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
  };
  const res = aggregateDayEntries('2026-09-10', entries, settings);
  assert('Late: 15m late', res.lateMinutes === 15, res.lateMinutes, 15);
}

// 4. Undertime: Schedule 08:00 -> 17:00, Lunch 12:00 -> 13:00, Actual 08:00 -> 16:00 => 7h worked, 1h undertime
{
  const entries = [{ workDate: '2026-09-10', timeIn: '08:00', timeOut: '16:00' }];
  const settings = {
    dailyHours: 8,
    useFixedSchedule: true,
    scheduleStart: '08:00',
    scheduleEnd: '17:00',
    lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
  };
  const res = aggregateDayEntries('2026-09-10', entries, settings);
  assert('Undertime: 7h worked, 60m (1h) undertime', res.totalCreditedHours === 7 && res.undertimeMinutes === 60, { total: res.totalCreditedHours, undertime: res.undertimeMinutes }, { total: 7, undertime: 60 });
}

// 5. Multiple entries: 08:00 -> 12:00, 13:00 -> 19:00 => 10h total, 8h regular, 2h OT
{
  const entries = [
    { workDate: '2026-09-10', timeIn: '08:00', timeOut: '12:00' },
    { workDate: '2026-09-10', timeIn: '13:00', timeOut: '19:00' },
  ];
  const settings = {
    dailyHours: 8,
    lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
  };
  const res = aggregateDayEntries('2026-09-10', entries, settings);
  assert('Multiple entries: 10h total, 8h regular, 2h OT', res.totalCreditedHours === 10 && res.regularHours === 8 && res.overtimeHours === 2, res, { total: 10, regular: 8, ot: 2 });
}

// 6. Overnight: 22:00 -> 06:00 => 8h duration
{
  const mins = calcRawDurationMins('22:00', '06:00');
  assert('Overnight: 22:00 to 06:00 is 480 mins (8h)', mins === 480, mins, 480);
}

// 7. Early arrival with fixed schedule: Schedule 08:00, Actual 07:30 => Early arrival is not automatically OT
{
  const entries = [{ workDate: '2026-09-10', timeIn: '07:30', timeOut: '17:00' }];
  const settings = {
    dailyHours: 8,
    useFixedSchedule: true,
    scheduleStart: '08:00',
    scheduleEnd: '17:00',
    earlyArrivalCountsAsOvertime: false,
    lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
  };
  const res = aggregateDayEntries('2026-09-10', entries, settings);
  assert('Early arrival with fixed schedule: 8h credited, 0 OT', res.totalCreditedHours === 8 && res.overtimeHours === 0, res, { total: 8, ot: 0 });
}

// 8. Future date validation
{
  const today = getManilaDateStr();
  const future = '2099-01-01';
  assert('Future date validation: 2099-01-01 is rejected', isFutureDate(future) === true, isFutureDate(future), true);
  assert('Today is not future date', isFutureDate(today) === false, isFutureDate(today), false);
}

// 10. OJT completion: 300h target, 300h30m actual => Completed, 30m surplus
{
  // Create entries that add up to 300h 30m
  // E.g. 30 days of 10h (300h) + 1 day of 0.5h
  const records = [];
  for (let i = 1; i <= 30; i++) {
    const day = String(i).padStart(2, '0');
    records.push({ workDate: `2026-08-${day}`, timeIn: '08:00', timeOut: '18:00' }); // 10h (no lunch)
  }
  records.push({ workDate: '2026-08-31', timeIn: '08:00', timeOut: '08:30' }); // 0.5h
  const settings = { dailyHours: 8, lunchBreak: { enabled: false } };
  const res = calcOjtTotals(records, 300, settings);
  assert('OJT completion: 300h30m actual on 300h target => completed with 30m surplus', res.isCompleted === true && res.surplusMins === 30 && res.remainingMins === 0, { isCompleted: res.isCompleted, surplusMins: res.surplusMins, remainingMins: res.remainingMins }, { isCompleted: true, surplusMins: 30, remainingMins: 0 });
}

if (failed === 0) {
  console.log('--- ALL CALCULATION ENGINE TESTS PASSED! ---');
} else {
  console.error(`--- ${failed} TESTS FAILED! ---`);
  process.exit(1);
}
