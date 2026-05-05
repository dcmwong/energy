const https = require('https');
const fs    = require('fs');
require('dotenv').config();

const SERIAL    = 'FA2310F309';
const OUT_FILE  = './ac-charge-2025.json';
const CONCURRENCY = 8;

function get(path) {
  const token = process.env.GIVENERGY_READ_TOKEN;
  return new Promise((resolve, reject) => {
    https.get(
      { hostname: 'api.givenergy.cloud', path, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(d));
          else reject(new Error(`HTTP ${res.statusCode} ${path}: ${d.slice(0, 120)}`));
        });
      }
    ).on('error', reject);
  });
}

function allDatesIn2025() {
  const dates = [];
  const d = new Date('2025-01-01');
  while (d <= new Date('2025-12-31')) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

async function fetchAcChargeForDate(date) {
  const first    = await get(`/v1/inverter/${SERIAL}/data-points/${date}?page=1`);
  const lastPage = first.meta.last_page;
  const last     = await get(`/v1/inverter/${SERIAL}/data-points/${date}?page=${lastPage}`);
  const lastPt   = last.data[last.data.length - 1];
  return lastPt ? lastPt.today.ac_charge : 0;
}

async function runBatch(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  // Load existing cache
  const cache = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {};

  const dates   = allDatesIn2025();
  const missing = dates.filter(d => !(d in cache));

  if (missing.length === 0) {
    console.log('Cache complete — nothing to fetch.');
  } else {
    console.log(`Fetching ac_charge for ${missing.length} dates (${CONCURRENCY} concurrent)...`);
    let done = 0;
    await runBatch(missing, async (date) => {
      try {
        cache[date] = await fetchAcChargeForDate(date);
      } catch (e) {
        console.warn(`  skipped ${date}: ${e.message}`);
        cache[date] = null;
      }
      done++;
      if (done % 20 === 0 || done === missing.length)
        process.stdout.write(`  ${done}/${missing.length}\r`);
    }, CONCURRENCY);
    console.log();
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(cache, null, 2));
  console.log(`Saved to ${OUT_FILE}`);

  // Quick sanity check
  const vals = Object.entries(cache).filter(([,v]) => v !== null);
  const avg  = vals.reduce((s,[,v]) => s + v, 0) / vals.length;
  console.log(`Average daily AC charge across 2025: ${avg.toFixed(2)} kWh`);
}

main().catch(err => console.error('Error:', err.message));
