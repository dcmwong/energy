const fs = require('fs');
const path = require('path');
const { findCheapestWindow } = require('./findCheapestWindow');

// Parse CSV into the same slot shape the API returns
function loadSlots(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
  return lines.map((line) => {
    const [from, to, importPrice] = line.split(',');
    const parseDate = (s) => {
      const [date, time] = s.trim().split(' ');
      const [d, m, y] = date.split('/');
      return new Date(`${y}-${m}-${d}T${time}:00Z`).toISOString();
    };
    return {
      valid_from: parseDate(from),
      valid_to: parseDate(to),
      value_exc_vat: parseFloat(importPrice),
    };
  });
}

const allSlots = loadSlots('./rates.csv');

// Grab one day's worth of slots (48 half-hour slots)
const jan1 = allSlots.filter((s) => s.valid_from.startsWith('2025-01-01'));

function getDatesIn2025() {
  const dates = [];
  const d = new Date('2025-01-01T00:00:00Z');
  while (d.getFullYear() === 2025) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

test('returns a window of the requested size', () => {
  const window = findCheapestWindow(jan1, 12);
  expect(window).toHaveLength(12);
});

test('returned window is cheaper than any other window on the same day', () => {
  const windowSize = 12;
  const window = findCheapestWindow(jan1, windowSize);
  const windowSum = window.reduce((acc, s) => acc + s.value_exc_vat, 0);

  for (let i = 0; i <= jan1.length - windowSize; i++) {
    const sum = jan1.slice(i, i + windowSize).reduce((acc, s) => acc + s.value_exc_vat, 0);
    expect(windowSum).toBeLessThanOrEqual(sum);
  }
});

test('slots in window are contiguous', () => {
  const window = findCheapestWindow(jan1, 12);
  for (let i = 1; i < window.length; i++) {
    expect(window[i].valid_from).toBe(window[i - 1].valid_to);
  }
});

test('cheapest 6-hour window for each day in 2025', () => {
  const dates = getDatesIn2025();
  const results = [];
  const csvLines = ['date,start,end,avg_p_per_kwh'];

  for (const date of dates) {
    const daySlots = allSlots.filter((s) => s.valid_from.startsWith(date));
    if (daySlots.length < 12) continue;

    const window = findCheapestWindow(daySlots, 12);
    const sum = window.reduce((acc, s) => acc + s.value_exc_vat, 0);
    const avg = sum / window.length;
    results.push({ date, start: window[0].valid_from, end: window[11].valid_to, avg });
    csvLines.push(`${date},${window[0].valid_from.slice(11, 16)},${window[11].valid_to.slice(11, 16)},${avg.toFixed(4)}`);
  }

  fs.writeFileSync(path.join(__dirname, 'cheapest-windows-2025.csv'), csvLines.join('\n'));

  const overallAvg = results.reduce((acc, r) => acc + r.avg, 0) / results.length;

  // console.log('\nCheapest 6-hour window per day (2025):');
  // console.log('Date        Start (UTC)           End (UTC)             Avg p/kWh');
  // console.log('-'.repeat(75));
  // for (const r of results) {
  //   console.log(`${r.date}  ${r.start.slice(11, 16)}  →  ${r.end.slice(11, 16)}  ${r.avg.toFixed(4)}p`);
  // }
  // console.log('-'.repeat(75));
  console.log(`Overall average across all days: ${overallAvg.toFixed(4)}p/kWh`);

  expect(results).toHaveLength(365);
  expect(overallAvg).toBeLessThan(20);
});
