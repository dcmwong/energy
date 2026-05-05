const fs = require('fs');
const path = require('path');

const BATTERY_KWH   = 9.5;   // inferred from charge data; override if known
const IOG_OVERNIGHT = 8.00;  // p/kWh
const IOG_DAYTIME   = 32.75; // p/kWh

const acChargeCache = fs.existsSync('./ac-charge-2025.json')
  ? JSON.parse(fs.readFileSync('./ac-charge-2025.json', 'utf8'))
  : null;

if (!acChargeCache) {
  console.error('ac-charge-2025.json not found — run `node fetch-ac-charge.js` first.');
  process.exit(1);
}

function localHour(iso) {
  const local = new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
  const [h, m] = local.split(':').map(Number);
  return h + m / 60;
}

function isOvernight(iso) {
  const h = localHour(iso);
  return h >= 23.5 || h < 5.5;
}

// Parse all 2025 monthly CSVs
const slots = [];
const dir = path.join(__dirname, '2025');
for (const file of fs.readdirSync(dir).sort()) {
  if (!file.endsWith('.csv')) continue;
  for (const line of fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').slice(1)) {
    const parts = line.split(',');
    slots.push({
      kwh:   Math.max(0, parseFloat(parts[0].trim())), // floor negative at 0
      start: parts[3].trim(),
    });
  }
}

// Group by local date
const byDay = new Map();
for (const s of slots) {
  const localDate = new Date(s.start).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (!byDay.has(localDate)) byDay.set(localDate, { overnight: 0, daytime: 0 });
  const d = byDay.get(localDate);
  if (isOvernight(s.start)) d.overnight += s.kwh;
  else                       d.daytime  += s.kwh;
}

// Per-day analysis
const monthly = new Map();
let fullDays = 0, shortfallDays = 0, totalShortfall = 0;

for (const [date, d] of [...byDay.entries()].sort()) {
  const mk = date.slice(0, 7);
  if (!monthly.has(mk)) monthly.set(mk, {
    overnight: 0, daytime: 0, fullDays: 0, shortfallDays: 0, shortfall: 0,
  });
  const m = monthly.get(mk);

  // Subtract AC charge from daytime import: on IOG, that charging moves overnight.
  // The remaining daytime import is genuine house load the battery couldn't cover.
  const acCharge    = acChargeCache[date] ?? 0;
  const iogDaytime  = Math.max(0, d.daytime - acCharge);
  const coveredByBattery = iogDaytime === 0;
  const shortfall   = iogDaytime;

  m.overnight  += d.overnight;
  m.daytime    += iogDaytime;
  m.shortfall  += shortfall;
  if (coveredByBattery) m.fullDays++; else m.shortfallDays++;

  if (coveredByBattery) fullDays++; else shortfallDays++;
  totalShortfall += shortfall;
}

// Print monthly table
console.log(`Battery assumed: ${BATTERY_KWH} kWh\n`);
console.log(
  `${'Month'.padEnd(8)}  ${'Overnight'.padStart(10)}  ${'Daytime'.padStart(9)}  ${'Full days'.padStart(10)}  ${'Shortfall days'.padStart(15)}  ${'Peak kWh'.padStart(10)}  ${'Peak cost'.padStart(10)}`
);
console.log('─'.repeat(84));

for (const [mk, m] of [...monthly.entries()].sort()) {
  const peakCost = m.daytime * IOG_DAYTIME;
  const days = m.fullDays + m.shortfallDays;
  console.log(
    `${mk.padEnd(8)}  ${m.overnight.toFixed(1).padStart(10)}  ${m.daytime.toFixed(1).padStart(9)}  ${(m.fullDays+'/'+days).padStart(10)}  ${(m.shortfallDays+' days').padStart(15)}  ${m.daytime.toFixed(1).padStart(10)}  ${peakCost.toFixed(0).padStart(9)}p`
  );
}

console.log('─'.repeat(84));
const totalDays = fullDays + shortfallDays;
const totalPeakCost = totalShortfall * IOG_DAYTIME;
console.log(
  `${'TOTAL'.padEnd(8)}  ${''.padStart(10)}  ${''.padStart(9)}  ${(fullDays+'/'+totalDays).padStart(10)}  ${(shortfallDays+' days').padStart(15)}  ${totalShortfall.toFixed(1).padStart(10)}  ${totalPeakCost.toFixed(0).padStart(9)}p`
);

console.log(`\n${fullDays} of ${totalDays} days (${((fullDays/totalDays)*100).toFixed(0)}%) had zero daytime grid draw — battery + solar fully covered the day.`);
console.log(`${shortfallDays} days had some daytime grid import totalling ${totalShortfall.toFixed(1)} kWh = £${(totalPeakCost/100).toFixed(2)} at peak IOG rate.`);
console.log(`\nNote: daytime import from CSV is net of solar. Zero daytime import = battery (+ solar) covered all daytime needs.`);
console.log(`      Negative Agile slots are floored to 0 kWh (export, not import).`);
