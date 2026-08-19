/**
 * Helper to pause execution for a randomized duration between min and max milliseconds.
 * Useful to mimic human pacing and bypass robotic request pattern detection.
 * 
 * @param {number} min Minimum wait time in ms (default 1500)
 * @param {number} max Maximum wait time in ms (default 4000)
 * @returns {Promise<number>} Resolves with the actual millisecond delay waited.
 */
function wait(min = 1500, max = 4000) {
  if (min > max) {
    const temp = min;
    min = max;
    max = temp;
  }
  
  const delayMs = Math.floor(Math.random() * (max - min + 1)) + min;
  
  console.log(`[Pacing] Waiting ${delayMs}ms before next request sequence to mimic human behavior...`);
  
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(delayMs);
    }, delayMs);
  });
}

module.exports = {
  wait
};
