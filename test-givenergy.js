// Usage: node test-givenergy.js HH:MM HH:MM [HH:MM HH:MM]
// Example (one slot):  node test-givenergy.js 01:00 03:00
// Example (two slots): node test-givenergy.js 01:00 03:00 13:00 16:00
const { setChargingSlots } = require('./givenergy-controller');

const args = process.argv.slice(2);
const valid = (t) => /^\d{2}:\d{2}$/.test(t);

if ((args.length !== 2 && args.length !== 4) || !args.every(valid)) {
  console.error('Usage: node test-givenergy.js HH:MM HH:MM [HH:MM HH:MM]');
  process.exit(1);
}

const slot1 = { start: args[0], end: args[1] };
const slot2 = args.length === 4 ? { start: args[2], end: args[3] } : null;

console.log(`Slot 1: ${slot1.start} → ${slot1.end}`);
if (slot2) console.log(`Slot 2: ${slot2.start} → ${slot2.end}`);
else console.log('Slot 2: cleared');

setChargingSlots(slot1, slot2)
  .then(() => console.log('✅ Done'))
  .catch(e => console.error('❌', e.message));
