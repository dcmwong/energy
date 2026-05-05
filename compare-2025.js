const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { fetchRates, toLocalHHMM } = require('./lib');

const IOG = { product: 'INTELLI-FIX-12M-26-04-18', tariff: 'E-1R-INTELLI-FIX-12M-26-04-18' };

function parseCSVs() {
  const dir = path.join(__dirname, '2025');
  const slots = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.csv')) continue;
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').slice(1);
    for (const line of lines) {
      const [kwh, cost, , start, end] = line.split(',').map(s => s.trim());
      slots.push({
        kwh:   parseFloat(kwh),
        cost:  parseFloat(cost),  // actual Agile cost inc VAT (p)
        start,
        end,
      });
    }
  }
  return slots;
}

// Given a UTC ISO string, return local (Europe/London) HH:MM as decimal hours
function localHour(iso) {
  const d = new Date(iso);
  const local = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const [h, m] = local.split(':').map(Number);
  return h + m / 60;
}

function isOvernightSlot(iso) {
  const h = localHour(iso);
  // Cheap window: 23:30–05:30 local time
  return h >= 23.5 || h < 5.5;
}

function iogRateForSlot(iso, cheapRate, standardRate) {
  return isOvernightSlot(iso) ? cheapRate : standardRate;
}

function monthKey(iso) {
  return iso.slice(0, 7); // "2025-01"
}

async function main() {
  process.stdout.write('Loading 2025 consumption data...');
  const slots = parseCSVs();
  console.log(` ${slots.length} half-hour slots loaded.\n`);

  process.stdout.write('Fetching IOG rate structure...');
  const iogRates = await fetchRates(IOG.product, IOG.tariff);
  const cheapRate    = Math.min(...iogRates.map(r => r.value_inc_vat));
  const standardRate = Math.max(...iogRates.map(r => r.value_inc_vat));
  console.log(` overnight ${cheapRate.toFixed(2)}p/kWh, daytime ${standardRate.toFixed(2)}p/kWh\n`);

  // Aggregate by month
  const months = new Map();
  let totalKwh = 0, totalAgile = 0, totalIog = 0;

  for (const slot of slots) {
    const mk = monthKey(slot.start);
    if (!months.has(mk)) months.set(mk, { kwh: 0, agile: 0, iog: 0 });
    const m = months.get(mk);

    const iogCost = slot.kwh * iogRateForSlot(slot.start, cheapRate, standardRate);

    m.kwh   += slot.kwh;
    m.agile += slot.cost;
    m.iog   += iogCost;

    totalKwh   += slot.kwh;
    totalAgile += slot.cost;
    totalIog   += iogCost;
  }

  // Print monthly table
  const W = 70;
  console.log(`${'Month'.padEnd(8)}  ${'kWh'.padStart(8)}  ${'Agile (p)'.padStart(10)}  ${'IOG (p)'.padStart(10)}  ${'Diff (p)'.padStart(10)}  ${'Diff %'.padStart(7)}`);
  console.log('─'.repeat(W));

  for (const [mk, m] of [...months.entries()].sort()) {
    const diff    = m.agile - m.iog;
    const diffPct = m.agile !== 0 ? (diff / Math.abs(m.agile)) * 100 : 0;
    const arrow   = diff > 0 ? '▼' : '▲';
    console.log(
      `${mk.padEnd(8)}  ${m.kwh.toFixed(1).padStart(8)}  ${m.agile.toFixed(0).padStart(10)}  ${m.iog.toFixed(0).padStart(10)}  ${diff.toFixed(0).padStart(10)}  ${(arrow + diffPct.toFixed(1) + '%').padStart(7)}`
    );
  }

  console.log('─'.repeat(W));
  const totalDiff    = totalAgile - totalIog;
  const totalDiffPct = (totalDiff / Math.abs(totalAgile)) * 100;
  console.log(
    `${'TOTAL'.padEnd(8)}  ${totalKwh.toFixed(1).padStart(8)}  ${totalAgile.toFixed(0).padStart(10)}  ${totalIog.toFixed(0).padStart(10)}  ${totalDiff.toFixed(0).padStart(10)}  ${(totalDiffPct.toFixed(1) + '%').padStart(7)}`
  );

  console.log(`\n  = £${(totalDiff / 100).toFixed(2)} ${totalDiff > 0 ? 'saved' : 'extra'} on IOG vs Agile across all of 2025`);
  console.log(`\nNote: IOG comparison uses same consumption pattern (no behaviour change assumed).`);
  console.log(`      IOG overnight window 23:30–05:30 at ${cheapRate.toFixed(2)}p, daytime at ${standardRate.toFixed(2)}p.`);
}

main().catch(err => console.error('Error:', err.message));
