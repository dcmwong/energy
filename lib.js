const https = require('https');
require('dotenv').config();

const SERIAL = 'FA2310F309';

const yesterday = new Date();
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const date = yesterday.toISOString().slice(0, 10);

const periodFrom = new Date(`${date}T00:00:00+01:00`).toISOString().replace('.000', '');
const dayAfter = new Date(`${date}T00:00:00+01:00`);
dayAfter.setDate(dayAfter.getDate() + 1);
const periodTo = dayAfter.toISOString().replace('.000', '');

function getGivEnergy(path) {
  const token = process.env.GIVENERGY_READ_TOKEN;
  if (!token) { console.error('GIVENERGY_READ_TOKEN not set'); process.exit(1); }
  return new Promise((resolve, reject) => {
    https.get(
      { hostname: 'api.givenergy.cloud', path, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
          else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        });
      }
    ).on('error', reject);
  });
}

function getOctopus(path) {
  const apiKey = process.env.OCTOPUS_API_KEY;
  if (!apiKey) { console.error('OCTOPUS_API_KEY not set'); process.exit(1); }
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  return new Promise((resolve, reject) => {
    https.get(
      { hostname: 'api.octopus.energy', path, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
          else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        });
      }
    ).on('error', reject);
  });
}

async function fetchAllDataPoints() {
  const first = await getGivEnergy(`/v1/inverter/${SERIAL}/data-points/${date}?page=1`);
  const lastPage = first.meta.last_page;
  const pages = [first.data];
  for (let p = 2; p <= lastPage; p++) {
    const res = await getGivEnergy(`/v1/inverter/${SERIAL}/data-points/${date}?page=${p}`);
    pages.push(res.data);
  }
  return pages.flat();
}

async function fetchRates(productCode, tariffPrefix) {
  const region = process.env.OCTOPUS_REGION;
  if (!region) { console.error('OCTOPUS_REGION not set'); process.exit(1); }
  const tariffCode = `${tariffPrefix}-${region}`;
  const { results } = await getOctopus(
    `/v1/products/${productCode}/electricity-tariffs/${tariffCode}/standard-unit-rates/?period_from=${periodFrom}&period_to=${periodTo}&page_size=100`
  );
  return results.sort((a, b) => new Date(a.valid_from) - new Date(b.valid_from));
}

async function fetchMeterDetails() {
  const accountNumber = process.env.OCTOPUS_ACCOUNT_NUMBER;
  if (!accountNumber) { console.error('OCTOPUS_ACCOUNT_NUMBER not set'); process.exit(1); }
  const account = await getOctopus(`/v1/accounts/${accountNumber}/`);
  // Import meter is the one with positive MPAN (not the export/generation meter)
  const importMeter = account.properties[0].electricity_meter_points
    .find(mp => mp.agreements.some(a => !a.tariff_code.includes('OUTGOING') && !a.tariff_code.includes('EXPORT')));
  return { mpan: importMeter.mpan, serial: importMeter.meters[0].serial_number };
}

async function fetchConsumption(mpan, serial) {
  const { results } = await getOctopus(
    `/v1/electricity-meter-points/${mpan}/meters/${serial}/consumption/?period_from=${periodFrom}&period_to=${periodTo}&page_size=48&order_by=period`
  );
  return results;
}

function rateForTime(t, rates) {
  const ms = new Date(t).getTime();
  const slot = rates.find(r => ms >= new Date(r.valid_from).getTime() && ms < new Date(r.valid_to).getTime());
  return slot ? slot.value_inc_vat : null;
}

function toLocalHHMM(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

function downsample(points, target) {
  if (points.length <= target) return points;
  const step = points.length / target;
  return Array.from({ length: target }, (_, i) => points[Math.round(i * step)]);
}

function alignRatesToPoints(points, rates) {
  return points.map(p => {
    const t = new Date(p.time).getTime();
    const slot = rates.find(r => t >= new Date(r.valid_from).getTime() && t < new Date(r.valid_to).getTime());
    return slot ? slot.value_inc_vat : null;
  });
}

function timeAxis(points, width) {
  const labels = Array(width).fill(' ');
  const start = new Date(points[0].time);
  const end = new Date(points[points.length - 1].time);
  const totalMs = end - start;
  for (let h = 0; h <= 23; h++) {
    const hourMs = new Date(start);
    hourMs.setUTCHours(new Date(points[0].time).getUTCHours(), 0, 0, 0);
    const markMs = new Date(hourMs.getTime() + h * 3600000).getTime();
    const frac = (markMs - start.getTime()) / totalMs;
    const idx = Math.round(frac * (width - 1));
    if (idx >= 0 && idx < width && idx + 2 < width) {
      const label = String(h).padStart(2, '0');
      labels[idx] = label[0];
      labels[idx + 1] = label[1];
    }
  }
  return labels.join('');
}

// Cost of a consumption dataset under a given rate schedule
function calcCost(consumption, rates) {
  return consumption.reduce((total, c) => {
    const rate = rateForTime(c.interval_start, rates);
    return rate !== null ? total + c.consumption * rate : total;
  }, 0);
}

module.exports = {
  date, periodFrom, periodTo,
  fetchAllDataPoints, fetchRates, fetchMeterDetails, fetchConsumption,
  rateForTime, toLocalHHMM, downsample, alignRatesToPoints, timeAxis, calcCost,
};
