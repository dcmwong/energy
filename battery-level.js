// Reads current battery SOC from GivEnergy inverter.
// Requires GIVENERGY_READ_TOKEN in .env (needs api:inverter:read scope).
const https = require('https');
require('dotenv').config();

const SERIAL = 'FA2310F309';

const token = process.env.GIVENERGY_READ_TOKEN;
if (!token) {
  console.error('GIVENERGY_READ_TOKEN not set in .env');
  process.exit(1);
}

https.get({
  hostname: 'api.givenergy.cloud',
  path: `/v1/inverter/${SERIAL}/system-data/latest`,
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`HTTP ${res.statusCode}:`, d);
      process.exit(1);
    }
    const { data } = JSON.parse(d);
    const soc = data?.battery?.percent;
    console.log(`Battery: ${soc}%`);
    // Export for use by other scripts
    module.exports = soc;
  });
}).on('error', e => console.error(e.message));
