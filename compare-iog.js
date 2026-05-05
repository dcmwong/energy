const fs   = require('fs');
const path = require('path');
const { findCheapestWindow } = require('./findCheapestWindow');

const IOG_OVERNIGHT_RATE = 8.00;  // p/kWh inc VAT (23:30–05:30 local)
const IOG_DAYTIME_RATE   = 32.75; // p/kWh inc VAT (05:30–23:30 local)
const BATTERY_KWH        = 9.5;
const WINDOW_SLOTS       = 12;    // 6 hours

if (!fs.existsSync('./ac-charge-2025.json')) {
  console.error('ac-charge-2025.json not found — run `node fetch-ac-charge.js` first.');
  process.exit(1);
}
const acCharge = JSON.parse(fs.readFileSync('./ac-charge-2025.json', 'utf8'));

function parseCSV(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
}

function localHour(iso) {
  const t = new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
}

function isOvernight(iso) {
  const h = localHour(iso);
  return h >= 23.5 || h < 5.5;
}

// Load Agile rates keyed by UTC ISO slot start
const rateMap = new Map();
const allRateSlots = [];
for (const line of parseCSV('./rates.csv')) {
  const parts = line.split(',');
  const parseDate = (s) => {
    const [date, time] = s.trim().split(' ');
    const [d, m, y] = date.split('/');
    return `${y}-${m}-${d}T${time}:00Z`;
  };
  const from = parseDate(parts[0]);
  rateMap.set(from, parseFloat(parts[2]));
  allRateSlots.push({ valid_from: from, valid_to: parseDate(parts[1]), value_exc_vat: parseFloat(parts[2]) });
}

// Load all 2025 monthly CSVs, split per day into overnight/daytime buckets
const byDay = new Map(); // date → { overnight, daytime, agileCost }
const dir   = path.join(__dirname, '2025');
for (const file of fs.readdirSync(dir).sort()) {
  if (!file.endsWith('.csv')) continue;
  for (const line of parseCSV(path.join(dir, file))) {
    const parts = line.split(',');
    const kwh   = parseFloat(parts[0].trim());
    const cost  = parseFloat(parts[1].trim()); // actual Agile cost inc VAT (p)
    const start = parts[3].trim();
    const isoStart = new Date(start).toISOString().slice(0, 16) + ':00Z';
    const date  = new Date(start).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

    if (!byDay.has(date)) byDay.set(date, { overnight: 0, daytime: 0, agileCost: 0 });
    const d = byDay.get(date);
    if (isOvernight(start)) d.overnight += Math.max(0, kwh);
    else                    d.daytime   += Math.max(0, kwh);
    d.agileCost += cost;
  }
}

// Monthly accumulators
const monthly = new Map();
let totKwh = 0, totActual = 0, totBestAgile = 0, totIog = 0, totPeakDays = 0;

for (const [date, d] of [...byDay.entries()].sort()) {
  const dayRateSlots = allRateSlots.filter(s => s.valid_from.startsWith(date));
  if (dayRateSlots.length < WINDOW_SLOTS) continue;

  const ac             = acCharge[date] ?? 0;
  const dayKwh         = d.overnight + d.daytime;

  // House load = daytime import minus battery charging (which moves to overnight on IOG)
  const daytimeHouseLoad = Math.max(0, d.daytime - ac);

  // IOG cost:
  //   overnight: house overnight load + battery charging, all at 8p
  //   daytime:   any house load the 9.5kWh battery couldn't cover, at 32.75p
  const peakExcess  = Math.max(0, daytimeHouseLoad - BATTERY_KWH);
  const iogCost     = (d.overnight + ac) * IOG_OVERNIGHT_RATE + peakExcess * IOG_DAYTIME_RATE;
  const isPeakDay   = peakExcess > 0;

  // Best possible Agile (all kWh in cheapest 6hr window)
  const cheapest    = findCheapestWindow(dayRateSlots, WINDOW_SLOTS);
  const cheapestAvg = cheapest.reduce((s, r) => s + r.value_exc_vat, 0) / cheapest.length;
  const bestAgile   = dayKwh * cheapestAvg;

  const mk = date.slice(0, 7);
  if (!monthly.has(mk)) monthly.set(mk, { kwh: 0, actual: 0, bestAgile: 0, iog: 0, peakDays: 0 });
  const m = monthly.get(mk);
  m.kwh      += dayKwh;
  m.actual   += d.agileCost;
  m.bestAgile += bestAgile;
  m.iog      += iogCost;
  if (isPeakDay) m.peakDays++;

  totKwh      += dayKwh;
  totActual   += d.agileCost;
  totBestAgile += bestAgile;
  totIog      += iogCost;
  if (isPeakDay) totPeakDays++;
}

const W = 96;
console.log(
  `${'Month'.padEnd(8)}  ${'kWh'.padStart(7)}  ${'Actual Agile'.padStart(13)}  ${'Best Agile'.padStart(11)}  ${'IOG model'.padStart(10)}  ${'Agile vs IOG'.padStart(13)}  ${'Peak days'.padStart(10)}`
);
console.log('─'.repeat(W));

for (const [mk, m] of [...monthly.entries()].sort()) {
  const diff    = m.actual - m.iog;
  const diffPct = (diff / Math.abs(m.actual)) * 100;
  console.log(
    `${mk.padEnd(8)}  ${m.kwh.toFixed(1).padStart(7)}  ${m.actual.toFixed(0).padStart(12)}p  ${m.bestAgile.toFixed(0).padStart(10)}p  ${m.iog.toFixed(0).padStart(9)}p  ${((diff >= 0 ? '+' : '') + diff.toFixed(0)).padStart(12)}p (${diffPct.toFixed(1).padStart(5)}%)  ${m.peakDays.toString().padStart(10)}`
  );
}

console.log('─'.repeat(W));
const totalDiff = totActual - totIog;
console.log(
  `${'TOTAL'.padEnd(8)}  ${totKwh.toFixed(1).padStart(7)}  ${totActual.toFixed(0).padStart(12)}p  ${totBestAgile.toFixed(0).padStart(10)}p  ${totIog.toFixed(0).padStart(9)}p  ${((totalDiff >= 0 ? '+' : '') + totalDiff.toFixed(0)).padStart(12)}p (${((totalDiff / Math.abs(totActual)) * 100).toFixed(1).padStart(5)}%)  ${totPeakDays.toString().padStart(10)}`
);

console.log(`\n  Actual Agile vs IOG model:   £${(totalDiff / 100).toFixed(2)} ${totalDiff >= 0 ? 'cheaper on Agile' : 'cheaper on IOG'}`);
console.log(`  Agile optimisation headroom: £${((totActual - totBestAgile) / 100).toFixed(2)} (saving if Agile charging always perfectly timed)`);
console.log(`\nIOG model assumptions:`);
console.log(`  · Battery: ${BATTERY_KWH} kWh charged to 100% overnight at ${IOG_OVERNIGHT_RATE}p`);
console.log(`  · Daytime house load covered by battery up to ${BATTERY_KWH} kWh, then ${IOG_DAYTIME_RATE}p/kWh from grid`);
console.log(`  · AC charge (from GivEnergy) moved from daytime to overnight`);
console.log(`  · Peak days = days where daytime house load exceeded ${BATTERY_KWH} kWh battery capacity`);
