const https = require('https');
require('dotenv').config();
const asciichart = require('asciichart');

const SERIAL = 'FA2310F309';

const yesterday = new Date();
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const date = yesterday.toISOString().slice(0, 10);

// Octopus period: yesterday local midnight → today local midnight (BST = UTC+1)
const periodFrom = new Date(`${date}T00:00:00+01:00`).toISOString().replace('.000', '');
const dayAfter = new Date(`${date}T00:00:00+01:00`);
dayAfter.setDate(dayAfter.getDate() + 1);
const periodTo = dayAfter.toISOString().replace('.000', '');

function getGivEnergy(path) {
  const token = process.env.GIVENERGY_READ_TOKEN;
  if (!token) { console.error('GIVENERGY_READ_TOKEN not set'); process.exit(1); }

  return new Promise((resolve, reject) => {
    https.get(
      {
        hostname: 'api.givenergy.cloud',
        path,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      },
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

function getOctopus(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
        else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    }).on('error', reject);
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

async function fetchRates() {
  const region = process.env.OCTOPUS_REGION;
  if (!region) { console.error('OCTOPUS_REGION not set'); process.exit(1); }
  const url = `https://api.octopus.energy/v1/products/AGILE-24-10-01/electricity-tariffs/E-1R-AGILE-24-10-01-${region}/standard-unit-rates/?period_from=${periodFrom}&period_to=${periodTo}&page_size=48`;
  const { results } = await getOctopus(url);
  return results.sort((a, b) => new Date(a.valid_from) - new Date(b.valid_from));
}

function downsample(points, target) {
  if (points.length <= target) return points;
  const step = points.length / target;
  return Array.from({ length: target }, (_, i) => points[Math.round(i * step)]);
}

// For each downsampled point, find the rate whose slot contains that timestamp
function alignRatesToPoints(points, rates) {
  return points.map(p => {
    const t = new Date(p.time).getTime();
    const slot = rates.find(r => t >= new Date(r.valid_from).getTime() && t < new Date(r.valid_to).getTime());
    return slot ? slot.value_inc_vat : null;
  });
}

// Build a time-axis label string with markers at each hour
function timeAxis(points, width) {
  const labels = Array(width).fill(' ');
  const start = new Date(points[0].time);
  const end = new Date(points[points.length - 1].time);
  const totalMs = end - start;

  for (let h = 0; h <= 23; h++) {
    const target = new Date(start);
    target.setUTCHours(start.getUTCHours() + Math.round((target - start) / 3600000), 0, 0, 0);
    // find the closest point index for each hour mark
    const hourMs = new Date(points[0].time);
    hourMs.setUTCHours(new Date(points[0].time).getUTCHours(), 0, 0, 0);
    const markMs = new Date(hourMs.getTime() + h * 3600000).getTime();
    const frac = (markMs - start.getTime()) / totalMs;
    const idx = Math.round(frac * (width - 1));
    if (idx >= 0 && idx < width) {
      const label = String(h).padStart(2, '0');
      if (idx + 2 < width) {
        labels[idx] = label[0];
        labels[idx + 1] = label[1];
      }
    }
  }
  return labels.join('');
}

function toLocalHHMM(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

async function main() {
  process.stdout.write(`Fetching GivEnergy data for ${date}...`);
  const [all, rates] = await Promise.all([fetchAllDataPoints(), fetchRates()]);
  console.log(` ${all.length} points, ${rates.length} rate slots.\n`);

  const WIDTH = 120;
  const points = downsample(all, WIDTH);

  const solar       = points.map(p => p.power.solar.power);
  const consumption = points.map(p => p.power.consumption.power);
  const battery     = points.map(p => p.power.battery.power);
  const grid        = points.map(p => p.power.grid.power);
  const battPct     = points.map(p => p.power.battery.percent);
  const rateValues  = alignRatesToPoints(points, rates);

  const startTime = toLocalHHMM(points[0].time);
  const endTime   = toLocalHHMM(points[points.length - 1].time);
  const axis      = timeAxis(points, WIDTH);

  console.log(`Power (W)  — ${date}  [${startTime}–${endTime}]`);
  console.log(`  ${asciichart.lightgreen} solar   ${asciichart.lightyellow} consumption   ${asciichart.lightblue} grid   ${asciichart.lightred} battery\n`);
  console.log(asciichart.plot([solar, consumption, grid, battery], {
    height: 20,
    colors: [asciichart.lightgreen, asciichart.lightyellow, asciichart.lightblue, asciichart.lightred],
  }));

  console.log(`\nBattery %`);
  console.log(asciichart.plot([battPct], {
    height: 8,
    min: 0,
    max: 100,
    colors: [asciichart.lightmagenta],
  }));

  console.log(`\nAgile rate (p/kWh inc VAT)`);
  console.log(asciichart.plot([rateValues], {
    height: 8,
    colors: [asciichart.lightyellow],
  }));

  // Pad the axis to account for the y-axis label width asciichart adds (9 chars)
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
}

main().catch((err) => console.error('Error:', err.message));
