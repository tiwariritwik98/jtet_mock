const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { pattern, sectionById, needsLanguage1 } = require('../config');
const { finalizeAttempt, expireIfNeeded } = require('../services/scoring');
const { rateLimit } = require('../middleware/candidate');
const { httpError } = require('../lib/http');

const router = express.Router();
const saveLimiter = rateLimit({ windowMs: 60 * 1000, max: 240 });
const GRACE_MS = 3000; // network latency allowance for saves right at the deadline

const idParam = z.coerce.number().int().positive();

// BR-04: an attempt is only visible to its owner (404 rather than 403 to avoid leaking ids).
async function getOwnedAttempt(req) {
  const id = idParam.parse(req.params.id);
  const a = await db.get('SELECT * FROM attempts WHERE id = ? AND user_id = ?', id, req.user.id);
  if (!a) throw httpError(404, 'Attempt not found.');
  return a;
}

const sectionsSummary = (rows) => {
  const order = [];
  const counts = {};
  for (const r of rows) {
    if (!(r.section in counts)) order.push(r.section);
    counts[r.section] = (counts[r.section] || 0) + 1;
  }
  return order.map((id) => ({ id, name: sectionById[id]?.name, count: counts[id] }));
};

// ---- Start (or resume) an attempt ------------------------------------------------------------

const startSchema = z.object({
  mockTestId: z.coerce.number().int().positive(),
  language1Choice: z.enum(['EN', 'HI']).optional(),
});

router.post('/attempts', async (req, res) => {
  const body = startSchema.parse(req.body);
  const test = await db.get('SELECT * FROM mock_tests WHERE id = ? AND is_published = 1', body.mockTestId);
  if (!test) throw httpError(404, 'Test not found.');
  if (needsLanguage1(test) && !body.language1Choice) throw httpError(400, 'Choose Language-1 (English or Hindi).');

  const existing = await db.get(`
    SELECT * FROM attempts WHERE user_id = ? AND mock_test_id = ? AND status = 'IN_PROGRESS'
    ORDER BY id DESC LIMIT 1`, req.user.id, test.id);
  if (existing && (await expireIfNeeded(existing)).status === 'IN_PROGRESS') {
    return res.json({ attemptId: existing.id, resumed: true });
  }

  const choice = needsLanguage1(test) ? body.language1Choice : null;
  const questions = (await db.all(`
    SELECT q.id, q.section, q.language FROM mock_test_questions mq JOIN questions q ON q.id = mq.question_id
    WHERE mq.mock_test_id = ? ORDER BY mq.order_no`, test.id))
    .filter((q) => q.section !== 'LANG1' || q.language === choice);
  if (!questions.length) throw httpError(400, 'This test has no questions yet.');

  const durationMinutes = test.type === 'FULL'
    ? test.duration_minutes
    : Math.max(1, Math.round(pattern.sectional.minutesPerQuestion * questions.length));
  const start = Date.now();

  const attemptId = await db.tx(async (t) => {
    const { id } = await t.get(`
      INSERT INTO attempts (user_id, mock_test_id, language1_choice, start_time, end_time, total_questions)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    req.user.id, test.id, choice, start, start + durationMinutes * 60_000, questions.length);
    // One multi-row insert keeps this to a single round trip on a remote database.
    const values = questions.map(() => '(?, ?, ?, ?)').join(', ');
    const params = questions.flatMap((q, i) => [id, q.id, i + 1, q.section]);
    await t.run(`INSERT INTO attempt_answers (attempt_id, question_id, order_no, section) VALUES ${values}`, ...params);
    return id;
  });

  res.status(201).json({ attemptId, resumed: false });
});

// ---- Exam data (never includes answers or explanations: BR-02) -----------------------------

router.get('/attempts/:id', async (req, res) => {
  const a = await expireIfNeeded(await getOwnedAttempt(req));
  if (a.status === 'SUBMITTED') return res.json({ id: a.id, status: 'SUBMITTED' });

  const test = await db.get('SELECT id, title, type, section_id FROM mock_tests WHERE id = ?', a.mock_test_id);
  const rows = await db.all(`
    SELECT aa.question_id, aa.order_no, aa.section, aa.selected_option, aa.is_marked_for_review, aa.visited,
           q.question_json, q.options_json
    FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
    WHERE aa.attempt_id = ? ORDER BY aa.order_no`, a.id);

  const now = Date.now();
  res.json({
    id: a.id,
    status: a.status,
    test: { id: test.id, title: test.title, type: test.type, sectionId: test.section_id },
    candidateName: req.user.name,
    language1Choice: a.language1_choice,
    serverNow: now,
    endTime: a.end_time,
    remainingSeconds: Math.max(0, Math.floor((a.end_time - now) / 1000)),
    sections: sectionsSummary(rows),
    questions: rows.map((r) => ({
      id: r.question_id,
      no: r.order_no,
      section: r.section,
      question: JSON.parse(r.question_json),
      options: JSON.parse(r.options_json),
      selected: r.selected_option,
      marked: !!r.is_marked_for_review,
      visited: !!r.visited,
    })),
  });
});

// ---- Auto-save one answer ------------------------------------------------------------------

const saveSchema = z.object({
  questionId: z.string().min(1).max(40),
  selectedOption: z.enum(['A', 'B', 'C', 'D']).nullable().optional(),
  markedForReview: z.boolean().optional(),
  visited: z.boolean().optional(),
  timeSpentSeconds: z.number().int().min(0).max(3600).optional(),
});

router.put('/attempts/:id/answers', saveLimiter, async (req, res) => {
  const a = await getOwnedAttempt(req);
  const b = saveSchema.parse(req.body);

  if (a.status === 'SUBMITTED') throw httpError(409, 'This attempt has already been submitted.');
  if (Date.now() > a.end_time + GRACE_MS) {
    await finalizeAttempt(a.id, 'AUTO');
    throw httpError(409, 'Time is over. Your test has been submitted.');
  }

  const sets = ['visited = 1'];
  const params = [];
  if (b.selectedOption !== undefined) { sets.push('selected_option = ?'); params.push(b.selectedOption); }
  if (b.markedForReview !== undefined) { sets.push('is_marked_for_review = ?'); params.push(b.markedForReview ? 1 : 0); }
  if (b.timeSpentSeconds) { sets.push('time_spent_seconds = time_spent_seconds + ?'); params.push(b.timeSpentSeconds); }

  const r = await db.run(`UPDATE attempt_answers SET ${sets.join(', ')} WHERE attempt_id = ? AND question_id = ?`,
    ...params, a.id, b.questionId);
  if (r.changes === 0) throw httpError(404, 'Question is not part of this attempt.');

  res.json({ ok: true });
});

// ---- Submit ---------------------------------------------------------------------------------

router.post('/attempts/:id/submit', async (req, res) => {
  const a = await getOwnedAttempt(req);
  const done = await finalizeAttempt(a.id, 'MANUAL');
  res.json({ ok: true, status: done.status, submitType: done.submit_type });
});

// ---- Result (submitted only) ----------------------------------------------------------------

async function requireSubmitted(req) {
  const a = await expireIfNeeded(await getOwnedAttempt(req));
  if (a.status !== 'SUBMITTED') throw httpError(403, 'Submit the test to unlock results and solutions.');
  return a;
}

router.get('/attempts/:id/result', async (req, res) => {
  const a = await requireSubmitted(req);
  const test = await db.get('SELECT title, type, section_id FROM mock_tests WHERE id = ?', a.mock_test_id);
  const rows = await db.all(`
    SELECT aa.question_id, aa.order_no, aa.section, aa.selected_option, aa.is_correct, aa.time_spent_seconds, q.topic
    FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
    WHERE aa.attempt_id = ? ORDER BY aa.order_no`, a.id);

  const sections = sectionsSummary(rows).map((s) => {
    const list = rows.filter((r) => r.section === s.id);
    const correct = list.filter((r) => r.is_correct === 1).length;
    const wrong = list.filter((r) => r.is_correct === 0).length;
    const attempted = correct + wrong;
    return {
      ...s,
      attempted,
      correct,
      wrong,
      skipped: list.length - attempted,
      score: correct * pattern.marking.correct + wrong * pattern.marking.wrong,
      maxMarks: list.length * pattern.marking.correct,
      accuracy: attempted ? Math.round((correct / attempted) * 1000) / 10 : 0,
      timeSeconds: list.reduce((t, r) => t + r.time_spent_seconds, 0),
    };
  });

  const maxMarks = a.total_questions * pattern.marking.correct;
  const percentage = maxMarks ? Math.round((a.score / maxMarks) * 1000) / 10 : 0;

  res.json({
    id: a.id,
    test: { title: test.title, type: test.type, sectionId: test.section_id },
    language1Choice: a.language1_choice,
    score: a.score,
    maxMarks,
    percentage,
    correct: a.correct_count,
    wrong: a.wrong_count,
    skipped: a.skipped_count,
    total: a.total_questions,
    startedAt: a.start_time,
    submittedAt: a.submitted_at,
    submitType: a.submit_type,
    timeTakenSeconds: Math.round((a.submitted_at - a.start_time) / 1000),
    durationSeconds: Math.round((a.end_time - a.start_time) / 1000),
    cutoffs: Object.entries(pattern.cutoffs).map(([category, cutoff]) => ({
      category, cutoff, qualified: percentage >= cutoff,
    })),
    sections,
    slowest: [...rows]
      .filter((r) => r.time_spent_seconds > 0)
      .sort((x, y) => y.time_spent_seconds - x.time_spent_seconds)
      .slice(0, 5)
      .map((r) => ({
        no: r.order_no, section: r.section, topic: r.topic, timeSeconds: r.time_spent_seconds,
        status: r.is_correct === 1 ? 'CORRECT' : r.is_correct === 0 ? 'WRONG' : 'SKIPPED',
      })),
  });
});

// ---- Solutions (BR-03: unlocked only after submission) -------------------------------------

router.get('/attempts/:id/solutions', async (req, res) => {
  const a = await requireSubmitted(req);
  const test = await db.get('SELECT title FROM mock_tests WHERE id = ?', a.mock_test_id);
  const rows = await db.all(`
    SELECT aa.*, q.topic, q.question_json, q.options_json, q.answer, q.explanation_json
    FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
    WHERE aa.attempt_id = ? ORDER BY aa.order_no`, a.id);

  res.json({
    id: a.id,
    test: { title: test.title },
    score: a.score,
    total: a.total_questions,
    sections: sectionsSummary(rows),
    questions: rows.map((r) => ({
      id: r.question_id,
      no: r.order_no,
      section: r.section,
      topic: r.topic,
      question: JSON.parse(r.question_json),
      options: JSON.parse(r.options_json),
      answer: r.answer,
      explanation: JSON.parse(r.explanation_json),
      selected: r.selected_option,
      marked: !!r.is_marked_for_review,
      status: r.is_correct === 1 ? 'CORRECT' : r.is_correct === 0 ? 'WRONG' : 'SKIPPED',
      timeSeconds: r.time_spent_seconds,
    })),
  });
});

// ---- History --------------------------------------------------------------------------------

router.get('/me/attempts', async (req, res) => {
  const raw = await db.all(`
    SELECT a.*, t.title, t.type, t.section_id FROM attempts a JOIN mock_tests t ON t.id = a.mock_test_id
    WHERE a.user_id = ? ORDER BY a.start_time DESC`, req.user.id);
  const rows = [];
  for (const r of raw) {
    rows.push(r.status === 'IN_PROGRESS' && Date.now() > r.end_time
      ? { ...r, ...(await finalizeAttempt(r.id, 'AUTO')) }
      : r);
  }

  const submitted = rows.filter((r) => r.status === 'SUBMITTED');
  const pct = (r) => (r.total_questions ? (r.score / (r.total_questions * pattern.marking.correct)) * 100 : 0);
  const round1 = (n) => Math.round(n * 10) / 10;

  res.json({
    stats: {
      attempted: submitted.length,
      bestPercentage: submitted.length ? round1(Math.max(...submitted.map(pct))) : null,
      averagePercentage: submitted.length ? round1(submitted.reduce((t, r) => t + pct(r), 0) / submitted.length) : null,
    },
    attempts: rows.map((r) => ({
      id: r.id,
      testId: r.mock_test_id,
      title: r.title,
      type: r.type,
      sectionId: r.section_id,
      status: r.status,
      startedAt: r.start_time,
      submittedAt: r.submitted_at,
      submitType: r.submit_type,
      score: r.score,
      total: r.total_questions,
      timeTakenSeconds: r.submitted_at ? Math.round((r.submitted_at - r.start_time) / 1000) : null,
    })),
  });
});

// ---- Report an error in a question ----------------------------------------------------------

const reportSchema = z.object({
  message: z.string().trim().min(3, 'Describe the problem').max(1000),
  attemptId: z.number().int().positive().optional(),
});

router.post('/questions/:id/report', rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), async (req, res) => {
  const questionId = z.string().min(1).max(40).parse(req.params.id);
  const b = reportSchema.parse(req.body);
  if (!(await db.get('SELECT 1 AS x FROM questions WHERE id = ?', questionId))) throw httpError(404, 'Question not found.');
  await db.run('INSERT INTO question_reports (user_id, question_id, attempt_id, message, created_at) VALUES (?, ?, ?, ?, ?)',
    req.user.id, questionId, b.attemptId ?? null, b.message, Date.now());
  res.status(201).json({ ok: true });
});

module.exports = router;
