const https = require('https');
const { setChargingSlots } = require('./givenergy-controller');
const { findCheapestWindow } = require('./findCheapestWindow');

const WINDOW_SLOTS = 12; // 6 hours total charging
const SPLIT_THRESHOLD_P_KWH = 1.0;

const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(0, 0, 0, 0);

const dayAfter = new Date(tomorrow);
dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

const periodFrom = tomorrow.toISOString().replace('.000', '');
const periodTo = dayAfter.toISOString().replace('.000', '');

const url = `https://api.octopus.energy/v1/products/AGILE-24-10-01/electricity-tariffs/E-1R-AGILE-24-10-01-C/standard-unit-rates/?period_from=${periodFrom}&period_to=${periodTo}`;

function toHHMM(iso) {
  return new Date(iso).toISOString().slice(11, 16);
}

function avgRate(slots) {
  return slots.reduce((a, s) => a + s.value_exc_vat, 0) / slots.length;
}

// Find the cheapest way to split WINDOW_SLOTS across two non-overlapping
// contiguous windows of any size (e.g. 3+9, 4+8, 6+6, etc.)
function findBestSplit(slots, totalSlots) {
  let best = Infinity;
  let bestPair = null;
  for (let sizeA = 1; sizeA < totalSlots; sizeA++) {
    const sizeB = totalSlots - sizeA;
    for (let i = 0; i <= slots.length - sizeA; i++) {
      const sumA = slots.slice(i, i + sizeA).reduce((a, s) => a + s.value_exc_vat, 0);
      for (let j = i + sizeA; j <= slots.length - sizeB; j++) {
        const sumB = slots.slice(j, j + sizeB).reduce((a, s) => a + s.value_exc_vat, 0);
        if (sumA + sumB < best) {
          best = sumA + sumB;
          bestPair = [slots.slice(i, i + sizeA), slots.slice(j, j + sizeB)];
        }
      }
    }
  }
  return bestPair;
}

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const { results } = JSON.parse(data);
    if (!results || results.length === 0) {
      console.log('No rates returned — has to be run after 4pm today.');
      return;
    }

    const slots = results.sort((a, b) => new Date(a.valid_from) - new Date(b.valid_from));

    const single = findCheapestWindow(slots, WINDOW_SLOTS);
    const singleAvg = avgRate(single);

    const pair = findBestSplit(slots, WINDOW_SLOTS);
    const pairAvg = avgRate(pair[0].concat(pair[1]));
    const saving = singleAvg - pairAvg;

    let slot1, slot2;

    if (saving >= SPLIT_THRESHOLD_P_KWH) {
      const [a, b] = pair;
      slot1 = { start: toHHMM(a[0].valid_from), end: toHHMM(a[a.length - 1].valid_to) };
      slot2 = { start: toHHMM(b[0].valid_from), end: toHHMM(b[b.length - 1].valid_to) };
      console.log(`Using split window: ${a.length / 2}hr + ${b.length / 2}hr (saves ${saving.toFixed(2)}p/kWh)`);
      console.log(`  Slot 1: ${slot1.start} → ${slot1.end}  (avg ${avgRate(a).toFixed(2)}p/kWh)`);
      console.log(`  Slot 2: ${slot2.start} → ${slot2.end}  (avg ${avgRate(b).toFixed(2)}p/kWh)`);
    } else {
      slot1 = { start: toHHMM(single[0].valid_from), end: toHHMM(single[single.length - 1].valid_to) };
      slot2 = null;
      console.log(`Using single 6hr window (split saves only ${saving.toFixed(2)}p/kWh)`);
      console.log(`  Slot 1: ${slot1.start} → ${slot1.end}  (avg ${singleAvg.toFixed(2)}p/kWh)`);
      console.log(`  Slot 2: cleared`);
    }
    console.log(slot1, slot2)

    setChargingSlots(slot1, slot2)
      .then(() => console.log('✅ Charging schedule updated'))
      .catch((err) => console.error('❌ Failed to update schedule:', err.message));
  });
}).on('error', (err) => console.error('Error fetching rates:', err.message));
