const fs = require('fs');
const { findCheapestWindow } = require('./findCheapestWindow');

function parseCSV(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
}

// Load rates keyed by slot start time (UTC ISO string, minute-precision)
const rateMap = new Map();
for (const line of parseCSV('./rates.csv')) {
  const [from, , importPrice] = line.split(',');
  const [date, time] = from.trim().split(' ');
  const [d, m, y] = date.split('/');
  const iso = `${y}-${m}-${d}T${time}:00Z`;
  rateMap.set(iso, parseFloat(importPrice));
}

// Build slot list for findCheapestWindow (same shape as API)
const allRateSlots = [];
for (const line of parseCSV('./rates.csv')) {
  const parts = line.split(',');
  const parseDate = (s) => {
    const [date, time] = s.trim().split(' ');
    const [d, m, y] = date.split('/');
    return new Date(`${y}-${m}-${d}T${time}:00Z`).toISOString();
  };
  allRateSlots.push({
    valid_from: parseDate(parts[0]),
    valid_to: parseDate(parts[1]),
    value_exc_vat: parseFloat(parts[2]),
  });
}

// Load usage
const usageSlots = [];
for (const line of parseCSV('./usage.csv')) {
  const parts = line.split(',');
  const kwh = parseFloat(parts[0]);
  const start = new Date(parts[3].trim()).toISOString().slice(0, 16) + ':00Z';
  usageSlots.push({ kwh, start });
}

// Group usage by date
const usageByDay = new Map();
for (const slot of usageSlots) {
  const date = slot.start.slice(0, 10);
  if (!usageByDay.has(date)) usageByDay.set(date, []);
  usageByDay.get(date).push(slot);
}

let totalActualCost = 0;
let totalCheapestCost = 0;
let totalKwh = 0;

console.log('Date        kWh     Actual (p)  Cheapest (p)  Diff (p)  Diff %');
console.log('-'.repeat(70));

for (const [date, slots] of [...usageByDay.entries()].sort()) {
  const dayRateSlots = allRateSlots.filter((s) => s.valid_from.startsWith(date));
  if (dayRateSlots.length < 12) continue;

  const cheapestWindow = findCheapestWindow(dayRateSlots, 12);
  const cheapestAvgRate = cheapestWindow.reduce((acc, s) => acc + s.value_exc_vat, 0) / cheapestWindow.length;

  let dayCost = 0;
  let dayKwh = 0;
  for (const slot of slots) {
    const rate = rateMap.get(slot.start);
    if (rate === undefined) continue;
    dayCost += slot.kwh * rate;
    dayKwh += slot.kwh;
  }

  const cheapestCost = dayKwh * cheapestAvgRate;
  const diff = dayCost - cheapestCost;
  const diffPct = dayCost !== 0 ? (diff / Math.abs(dayCost)) * 100 : 0;

  totalActualCost += dayCost;
  totalCheapestCost += cheapestCost;
  totalKwh += dayKwh;

  console.log(
    `${date}  ${dayKwh.toFixed(3).padStart(6)}  ${dayCost.toFixed(2).padStart(10)}  ${cheapestCost.toFixed(2).padStart(12)}  ${diff.toFixed(2).padStart(8)}  ${diffPct.toFixed(1).padStart(5)}%`
  );
}

console.log('-'.repeat(70));
console.log(`Total kWh consumed:       ${totalKwh.toFixed(3)}`);
console.log(`Actual total cost:        ${totalActualCost.toFixed(2)}p`);
console.log(`Cheapest window cost:     ${totalCheapestCost.toFixed(2)}p`);
console.log(`You paid extra:           ${(totalActualCost - totalCheapestCost).toFixed(2)}p  (${(((totalActualCost - totalCheapestCost) / Math.abs(totalCheapestCost)) * 100).toFixed(1)}% more)`);
