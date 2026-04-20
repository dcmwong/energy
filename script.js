const https = require('https');

const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(0, 0, 0, 0);

const dayAfter = new Date(tomorrow);
dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

const periodFrom = tomorrow.toISOString().replace('.000', '');
const periodTo = dayAfter.toISOString().replace('.000', '');

const url = `https://api.octopus.energy/v1/products/AGILE-24-10-01/electricity-tariffs/E-1R-AGILE-24-10-01-C/standard-unit-rates/?period_from=${periodFrom}&period_to=${periodTo}`;

https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    const { results } = JSON.parse(data);

    // Sort slots chronologically
    const slots = results.sort((a, b) => new Date(a.valid_from) - new Date(b.valid_from));

    const windowSize = 12; // 12 x 30-min slots = 6 hours
    let bestSum = Infinity;
    let bestIndex = 0;

    for (let i = 0; i <= slots.length - windowSize; i++) {
      const sum = slots.slice(i, i + windowSize).reduce((acc, s) => acc + s.value_exc_vat, 0);
      if (sum < bestSum) {
        bestSum = sum;
        bestIndex = i;
      }
    }

    const window = slots.slice(bestIndex, bestIndex + windowSize);
    const avg = bestSum / windowSize;

    console.log(`Cheapest 6-hour window: ${window[0].valid_from} → ${window[windowSize - 1].valid_to}`);
    console.log(`Average: ${avg.toFixed(4)}p/kWh (ex VAT)  |  Total: ${bestSum.toFixed(4)}p`);
    console.log('\nSlots:');
    window.forEach(s => console.log(`  ${s.valid_from} - ${s.valid_to}: ${s.value_exc_vat}p`));
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});
