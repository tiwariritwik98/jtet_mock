// BR-07: periodically auto-submit attempts whose end_time has passed.
const { db } = require('../db');
const { finalizeAttempt } = require('../services/scoring');

function runOnce() {
  const expired = db.prepare("SELECT id FROM attempts WHERE status = 'IN_PROGRESS' AND end_time < ?").all(Date.now());
  for (const { id } of expired) {
    try {
      finalizeAttempt(id, 'AUTO');
    } catch (err) {
      console.error(`Auto-submit failed for attempt ${id}:`, err);
    }
  }
  return expired.length;
}

function startAutoSubmitJob(intervalMs = 30_000) {
  runOnce();
  return setInterval(runOnce, intervalMs);
}

module.exports = { startAutoSubmitJob, runOnce };
