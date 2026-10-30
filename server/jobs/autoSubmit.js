// BR-07: periodically auto-submit attempts whose end_time has passed.
const { db } = require('../db');
const { finalizeAttempt } = require('../services/scoring');

async function runOnce() {
  const expired = await db.all("SELECT id FROM attempts WHERE status = 'IN_PROGRESS' AND end_time < ?", Date.now());
  for (const { id } of expired) {
    try {
      await finalizeAttempt(id, 'AUTO');
    } catch (err) {
      console.error(`Auto-submit failed for attempt ${id}:`, err);
    }
  }
  return expired.length;
}

function startAutoSubmitJob(intervalMs = 30_000) {
  const run = () => runOnce().catch((err) => console.error('Auto-submit job failed:', err));
  run();
  return setInterval(run, intervalMs);
}

module.exports = { startAutoSubmitJob, runOnce };
