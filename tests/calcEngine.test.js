import { timeToMins, calcRawDurationMins, calcOjtTotals, getPhilippineHolidays, fmt12 } from '../js/calcEngine.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('Testing calcEngine...');

// Test 1: Minutes conversion
assert(timeToMins('08:00') === 480, '08:00 should be 480 mins');
assert(timeToMins('17:00') === 1020, '17:00 should be 1020 mins');

// Test 2: Formatting 12-hour
assert(fmt12('08:00') === '8:00 AM', '08:00 should format to 8:00 AM');
assert(fmt12('17:00') === '5:00 PM', '17:00 should format to 5:00 PM');

// Test 3: Raw duration
assert(calcRawDurationMins('08:00', '17:00') === 540, 'Raw duration should be 540 mins (9h)');

// Test 4: Philippine Holidays
const holidays2026 = getPhilippineHolidays(2026);
assert(holidays2026.has('2026-12-25'), 'Christmas Day 2026 should exist');
assert(holidays2026.has('2026-01-01'), "New Year's Day 2026 should exist");

// Test 5: OJT Totals computation
const dummyRecords = [
  { workDate: '2026-03-01', timeIn: '08:00', timeOut: '17:00' },
  { workDate: '2026-03-02', timeIn: '08:00', timeOut: '17:00' }
];
const totals = calcOjtTotals(dummyRecords, 300, { dailyStandardHours: 8 });
assert(totals.totalCreditedMins === 1080, `Expected 1080 credited mins (18h), got ${totals.totalCreditedMins}`);
assert(totals.totalCreditedHours === 18, `Expected 18 credited hours, got ${totals.totalCreditedHours}`);
assert(totals.remainingHours === 282, `Expected 282 remaining hours, got ${totals.remainingHours}`);
assert(totals.progressPct === 6, `Expected 6% progress, got ${totals.progressPct}`);

console.log('✓ All calcEngine tests passed successfully!');
