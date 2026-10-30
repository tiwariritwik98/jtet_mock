const { db, tx } = require('../db');
const { pattern } = require('../config');

// Scores an attempt on the server and locks it. Idempotent.
function finalizeAttempt(attemptId, submitType) {
  return tx(() => {
    const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    if (!a || a.status === 'SUBMITTED') return a;

    db.prepare(`
      UPDATE attempt_answers SET is_correct = CASE
        WHEN selected_option IS NULL THEN NULL
        WHEN selected_option = (SELECT answer FROM questions q WHERE q.id = attempt_answers.question_id) THEN 1
        ELSE 0 END
      WHERE attempt_id = ?`).run(attemptId);

    const c = db.prepare(`
      SELECT COALESCE(SUM(is_correct = 1), 0) AS correct,
             COALESCE(SUM(is_correct = 0), 0) AS wrong,
             COALESCE(SUM(is_correct IS NULL), 0) AS skipped
      FROM attempt_answers WHERE attempt_id = ?`).get(attemptId);

    const now = Date.now();
    const type = now > a.end_time ? 'AUTO' : submitType;
    const score = c.correct * pattern.marking.correct + c.wrong * pattern.marking.wrong;

    db.prepare(`
      UPDATE attempts SET status = 'SUBMITTED', submit_type = ?, submitted_at = ?,
        score = ?, correct_count = ?, wrong_count = ?, skipped_count = ?
      WHERE id = ?`).run(type, Math.min(now, a.end_time), score, c.correct, c.wrong, c.skipped, attemptId);

    return db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
  });
}

// BR-06: an attempt whose time has run out is auto-submitted the moment anyone looks at it.
function expireIfNeeded(attempt) {
  if (attempt.status === 'IN_PROGRESS' && Date.now() > attempt.end_time) {
    return finalizeAttempt(attempt.id, 'AUTO');
  }
  return attempt;
}

module.exports = { finalizeAttempt, expireIfNeeded };
