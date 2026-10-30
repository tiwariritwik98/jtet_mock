const { db } = require('../db');
const { pattern } = require('../config');

// Scores an attempt on the server and locks it. Idempotent.
function finalizeAttempt(attemptId, submitType) {
  return db.tx(async (t) => {
    const a = await t.get('SELECT * FROM attempts WHERE id = ?', attemptId);
    if (!a || a.status === 'SUBMITTED') return a;

    await t.run(`
      UPDATE attempt_answers SET is_correct = CASE
        WHEN selected_option IS NULL THEN NULL
        WHEN selected_option = (SELECT answer FROM questions q WHERE q.id = attempt_answers.question_id) THEN 1
        ELSE 0 END
      WHERE attempt_id = ?`, attemptId);

    const c = await t.get(`
      SELECT COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct,
             COALESCE(SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END), 0) AS wrong,
             COALESCE(SUM(CASE WHEN is_correct IS NULL THEN 1 ELSE 0 END), 0) AS skipped
      FROM attempt_answers WHERE attempt_id = ?`, attemptId);

    const now = Date.now();
    const type = now > a.end_time ? 'AUTO' : submitType;
    const score = c.correct * pattern.marking.correct + c.wrong * pattern.marking.wrong;

    // The status guard makes a concurrent second finalize (manual submit vs. auto job) a no-op.
    await t.run(`
      UPDATE attempts SET status = 'SUBMITTED', submit_type = ?, submitted_at = ?,
        score = ?, correct_count = ?, wrong_count = ?, skipped_count = ?
      WHERE id = ? AND status = 'IN_PROGRESS'`,
    type, Math.min(now, a.end_time), score, c.correct, c.wrong, c.skipped, attemptId);

    return t.get('SELECT * FROM attempts WHERE id = ?', attemptId);
  });
}

// BR-06: an attempt whose time has run out is auto-submitted the moment anyone looks at it.
async function expireIfNeeded(attempt) {
  if (attempt.status === 'IN_PROGRESS' && Date.now() > attempt.end_time) {
    return finalizeAttempt(attempt.id, 'AUTO');
  }
  return attempt;
}

module.exports = { finalizeAttempt, expireIfNeeded };
