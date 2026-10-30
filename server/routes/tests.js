const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { SECTION_IDS, needsLanguage1, sectionById } = require('../config');
const { httpError, optional } = require('../lib/http');

const router = express.Router();

function withUserStatus(test, userId) {
  const inProgress = db.prepare(`
    SELECT id, end_time FROM attempts
    WHERE user_id = ? AND mock_test_id = ? AND status = 'IN_PROGRESS' ORDER BY id DESC LIMIT 1`).get(userId, test.id);
  const lastSubmitted = db.prepare(`
    SELECT id, score, total_questions FROM attempts
    WHERE user_id = ? AND mock_test_id = ? AND status = 'SUBMITTED' ORDER BY id DESC LIMIT 1`).get(userId, test.id);
  const live = inProgress && inProgress.end_time > Date.now() ? inProgress : null;

  return {
    id: test.id,
    title: test.title,
    type: test.type,
    sectionId: test.section_id,
    durationMinutes: test.duration_minutes,
    totalQuestions: test.total_questions,
    needsLanguage1: needsLanguage1(test),
    status: live ? 'IN_PROGRESS' : lastSubmitted ? 'COMPLETED' : 'NOT_ATTEMPTED',
    inProgressAttemptId: live?.id ?? null,
    lastAttempt: lastSubmitted
      ? { id: lastSubmitted.id, score: lastSubmitted.score, total: lastSubmitted.total_questions }
      : null,
  };
}

const listSchema = z.object({
  type: optional(z.enum(['FULL', 'SECTIONAL'])),
  section: optional(z.enum(SECTION_IDS)),
});

router.get('/tests', (req, res) => {
  const q = listSchema.parse(req.query);
  const tests = db.prepare(`
    SELECT * FROM mock_tests
    WHERE is_published = 1 AND (? IS NULL OR type = ?) AND (? IS NULL OR section_id = ?)
    ORDER BY type, section_id, id`).all(q.type ?? null, q.type ?? null, q.section ?? null, q.section ?? null);
  res.json({ tests: tests.map((t) => withUserStatus(t, req.user.id)) });
});

router.get('/tests/:id', (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const test = db.prepare('SELECT * FROM mock_tests WHERE id = ? AND is_published = 1').get(id);
  if (!test) throw httpError(404, 'Test not found.');

  const sections = db.prepare(`
    SELECT q.section AS id, q.language, COUNT(*) AS count
    FROM mock_test_questions mq JOIN questions q ON q.id = mq.question_id
    WHERE mq.mock_test_id = ? GROUP BY q.section, q.language ORDER BY MIN(mq.order_no)`).all(id);

  const merged = [];
  for (const s of sections) {
    const existing = merged.find((m) => m.id === s.id);
    if (existing) existing.count = Math.max(existing.count, s.count);
    else merged.push({ id: s.id, name: sectionById[s.id]?.name, count: s.count });
  }

  res.json({ test: { ...withUserStatus(test, req.user.id), sections: merged } });
});

module.exports = router;
