const https = require('https');
require('dotenv').config();

const SERIAL = 'FA2310F309';
const BASE = `https://api.givenergy.cloud/v1/inverter/${SERIAL}/settings`;

function writeSetting(id, value) {
  const token = process.env.GIVENERGY_API_TOKEN;
  if (!token) throw new Error('GIVENERGY_API_TOKEN not set');

  const body = JSON.stringify({ value, context: 'schedule-charging' });
  const url = new URL(`${BASE}/${id}/write`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
          else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Set AC charge slots and enable charging. Times in "HH:MM" format.
// slot2 is optional — pass null to clear it (sets 00:00–00:00).
async function setChargingSlots(slot1, slot2 = null) {
  await writeSetting(64,  slot1.start);           // AC Charge 1 Start Time
  await writeSetting(65,  slot1.end);             // AC Charge 1 End Time
  await writeSetting(102, slot2 ? slot2.start : '00:00'); // AC Charge 2 Start Time
  await writeSetting(103, slot2 ? slot2.end   : '00:00'); // AC Charge 2 End Time
  await writeSetting(66,  true);                  // AC Charge Enable
}

module.exports = { setChargingSlots };
