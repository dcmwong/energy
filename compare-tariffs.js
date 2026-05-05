require('dotenv').config();
const { findCheapestWindow } = require('./findCheapestWindow');
const {
  date, fetchAllDataPoints, fetchRates, fetchMeterDetails, fetchConsumption,
  rateForTime, toLocalHHMM, calcCost,
} = require('./lib');

const AGILE = { name: 'Agile',          product: 'AGILE-24-10-01',           tariff: 'E-1R-AGILE-24-10-01' };
const IOG   = { name: 'Intelligent Go', product: 'INTELLI-FIX-12M-26-04-18', tariff: 'E-1R-INTELLI-FIX-12M-26-04-18' };

// Count how many 30-min rate slots had AC charging, using GivEnergy data points
// A slot counts if the majority of readings in it show battery charging from grid
function detectChargingSlots(all, rates) {
  return rates.filter(r => {
    const slotStart = new Date(r.valid_from).getTime();
    const slotEnd   = new Date(r.valid_to).getTime();
    const inSlot    = all.filter(p => {
      const t = new Date(p.time).getTime();
      return t >= slotStart && t < slotEnd;
    });
    if (inSlot.length === 0) return false;
    const charging = inSlot.filter(p => p.power.battery.power > 100 && p.power.grid.power > 0);
    return charging.length / inSlot.length > 0.5;
  });
}

async function main() {
  process.stdout.write(`Fetching data for ${date}...`);
  const [all, agileRates, iogRates, meter] = await Promise.all([
    fetchAllDataPoints(),
    fetchRates(AGILE.product, AGILE.tariff),
    fetchRates(IOG.product, IOG.tariff),
    fetchMeterDetails(),
  ]);
  const consumption = await fetchConsumption(meter.mpan, meter.serial);
  console.log(` done.\n`);

  // Detect charging window from GivEnergy data
  const chargingSlots = detectChargingSlots(all, agileRates);
  const chargingHours = chargingSlots.length / 2;
  const totalAcCharge = all[all.length - 1].today.ac_charge;

  console.log(`Charging detected:   ${chargingSlots.length} slots (${chargingHours}h)`);
  console.log(`  from ${toLocalHHMM(chargingSlots[0].valid_from)} to ${toLocalHHMM(chargingSlots[chargingSlots.length - 1].valid_to)}`);
  console.log(`Total AC charged:    ${totalAcCharge.toFixed(2)} kWh\n`);

  // Actual Agile cost for the charging window
  const actualChargeCost = chargingSlots.reduce((sum, r) => {
    const c = consumption.find(c => c.interval_start === r.valid_from);
    return sum + (c ? c.consumption * r.value_inc_vat : 0);
  }, 0);
  const actualChargeAvg = actualChargeCost / totalAcCharge;

  // Cheapest IOG window of the same number of slots
  const cheapestIog = findCheapestWindow(
    iogRates.map(r => ({ ...r, value_exc_vat: r.value_inc_vat })),
    chargingSlots.length
  );
  const cheapestIogAvg  = cheapestIog.reduce((s, r) => s + r.value_exc_vat, 0) / cheapestIog.length;
  const modifiedIogCost = totalAcCharge * cheapestIogAvg;

  console.log(`── Charging cost comparison ────────────────────────────────────\n`);
  console.log(`Actual (Agile, ${toLocalHHMM(chargingSlots[0].valid_from)}–${toLocalHHMM(chargingSlots[chargingSlots.length-1].valid_to)}):`);
  console.log(`  Avg rate: ${actualChargeAvg.toFixed(2)}p/kWh   Cost: ${actualChargeCost.toFixed(2)}p\n`);
  console.log(`Modelled (Intelligent Go, cheapest ${chargingHours}h window):`);
  console.log(`  Window:   ${toLocalHHMM(cheapestIog[0].valid_from)}–${toLocalHHMM(cheapestIog[cheapestIog.length-1].valid_to)}`);
  console.log(`  Avg rate: ${cheapestIogAvg.toFixed(2)}p/kWh   Cost: ${modifiedIogCost.toFixed(2)}p\n`);

  const saving = actualChargeCost - modifiedIogCost;
  console.log(`Saving by switching:  ${saving.toFixed(2)}p  (£${(saving / 100).toFixed(2)})`);
}

main().catch((err) => console.error('Error:', err.message));
