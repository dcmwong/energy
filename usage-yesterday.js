require('dotenv').config();
const asciichart = require('asciichart');
const { findCheapestWindow } = require('./findCheapestWindow');
const {
  date, fetchAllDataPoints, fetchRates, fetchMeterDetails, fetchConsumption,
  rateForTime, toLocalHHMM, downsample, alignRatesToPoints, timeAxis,
} = require('./lib');

const WINDOW_SLOTS = 12; // 6 hours

const AGILE = { product: 'AGILE-24-10-01', tariff: 'E-1R-AGILE-24-10-01' };

async function main() {
  process.stdout.write(`Fetching data for ${date}...`);
  const [all, rates, meter] = await Promise.all([fetchAllDataPoints(), fetchRates(AGILE.product, AGILE.tariff), fetchMeterDetails()]);
  const consumption = await fetchConsumption(meter.mpan, meter.serial);
  console.log(` ${all.length} inverter points, ${rates.length} rate slots, ${consumption.length} consumption slots.\n`);

  const WIDTH = 120;
  const points = downsample(all, WIDTH);

  const solar      = points.map(p => p.power.solar.power);
  const cons       = points.map(p => p.power.consumption.power);
  const battery    = points.map(p => p.power.battery.power);
  const grid       = points.map(p => p.power.grid.power);
  const battPct    = points.map(p => p.power.battery.percent);
  const rateValues = alignRatesToPoints(points, rates);

  const startTime = toLocalHHMM(points[0].time);
  const endTime   = toLocalHHMM(points[points.length - 1].time);
  const axis      = timeAxis(points, WIDTH);

  console.log(`Power (W)  — ${date}  [${startTime}–${endTime}]`);
  console.log(`  ${asciichart.lightgreen} solar   ${asciichart.lightyellow} consumption   ${asciichart.lightblue} grid   ${asciichart.lightred} battery\n`);
  console.log(asciichart.plot([solar, cons, grid, battery], {
    height: 20,
    colors: [asciichart.lightgreen, asciichart.lightyellow, asciichart.lightblue, asciichart.lightred],
  }));

  console.log(`\nBattery %`);
  console.log(asciichart.plot([battPct], { height: 8, min: 0, max: 100, colors: [asciichart.lightmagenta] }));

  console.log(`\nAgile rate (p/kWh inc VAT)`);
  console.log(asciichart.plot([rateValues], { height: 8, colors: [asciichart.lightyellow] }));
  console.log('         ' + axis);

  const last = all[all.length - 1].today;
  console.log(`\nDay totals (kWh):`);
  console.log(`  Solar:        ${last.solar.toFixed(1)}`);
  console.log(`  Consumption:  ${last.consumption.toFixed(1)}`);
  console.log(`  Grid import:  ${last.grid.import.toFixed(1)}`);
  console.log(`  Grid export:  ${last.grid.export.toFixed(1)}`);
  console.log(`  Battery chg:  ${last.battery.charge.toFixed(1)}`);
  console.log(`  Battery dis:  ${last.battery.discharge.toFixed(1)}`);
  console.log(`  AC charge:    ${last.ac_charge.toFixed(1)}`);

  // Optimisation analysis using Octopus consumption data
  const slots = consumption.map(c => ({
    kwh: c.consumption,
    rate: rateForTime(c.interval_start, rates),
    time: c.interval_start,
  })).filter(s => s.rate !== null);

  const totalKwh  = slots.reduce((s, c) => s + c.kwh, 0);
  const actualCost = slots.reduce((s, c) => s + c.kwh * c.rate, 0);

  const cheapestWindow = findCheapestWindow(rates.map(r => ({ ...r, value_exc_vat: r.value_inc_vat })), WINDOW_SLOTS);
  const cheapestAvg    = cheapestWindow.reduce((s, r) => s + r.value_exc_vat, 0) / cheapestWindow.length;
  const optimalCost    = totalKwh * cheapestAvg;
  const saving         = actualCost - optimalCost;
  const savingPct      = actualCost > 0 ? (saving / actualCost) * 100 : 0;

  console.log('\n── Optimisation Analysis (Agile) ──────────────────────────────\n');
  console.log(`Total grid import:   ${totalKwh.toFixed(3)} kWh`);
  console.log(`Actual cost:         ${actualCost.toFixed(2)}p`);
  console.log(`Optimal cost:        ${optimalCost.toFixed(2)}p  (avg ${cheapestAvg.toFixed(2)}p/kWh in cheapest 6hr window)`);
  console.log(`Overspend:           ${saving.toFixed(2)}p  (${savingPct.toFixed(1)}% above optimal)\n`);

  console.log('Actual half-hourly consumption:');
  for (const s of slots) {
    const cost = (s.kwh * s.rate).toFixed(1);
    const bar  = '█'.repeat(Math.max(0, Math.round(s.rate / 2)));
    console.log(`  ${toLocalHHMM(s.time)}  ${s.rate.toFixed(2).padStart(6)}p/kWh  ${s.kwh.toFixed(3)} kWh  ${cost.padStart(5)}p  ${bar}`);
  }

  console.log('\nOptimal window would have been:');
  for (const s of cheapestWindow) {
    const bar = '█'.repeat(Math.max(0, Math.round(s.value_exc_vat / 2)));
    console.log(`  ${toLocalHHMM(s.valid_from)}  ${s.value_exc_vat.toFixed(2).padStart(6)}p/kWh  ${bar}`);
  }
}

main().catch((err) => console.error('Error:', err.message));
