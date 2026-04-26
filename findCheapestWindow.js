function findCheapestWindow(slots, windowSize) {
  let bestSum = Infinity;
  let bestIndex = 0;
  for (let i = 0; i <= slots.length - windowSize; i++) {
    const sum = slots.slice(i, i + windowSize).reduce((acc, s) => acc + s.value_exc_vat, 0);
    if (sum < bestSum) { bestSum = sum; bestIndex = i; }
  }
  return slots.slice(bestIndex, bestIndex + windowSize);
}

module.exports = { findCheapestWindow };
