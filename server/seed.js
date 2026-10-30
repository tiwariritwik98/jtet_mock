// Loads data/questions/*.json into the database and (re)builds the mock tests.
// Safe to re-run: questions and tests are upserted, past attempts are untouched.
const fs = require('node:fs');
const path = require('node:path');
const { db, tx } = require('./db');
const { pattern, sectionById, SECTION_IDS } = require('./config');

const QUESTIONS_DIR = path.join(__dirname, '..', 'data', 'questions');

function loadBank() {
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith('.json'));
  const seen = new Set();
  const all = [];
  for (const file of files) {
    const list = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, file), 'utf8'));
    if (!Array.isArray(list)) throw new Error(`${file}: expected an array of questions`);
    for (const q of list) {
      const where = `${file} → ${q.id || '(missing id)'}`;
      if (!q.id) throw new Error(`${where}: missing "id"`);
      if (seen.has(q.id)) throw new Error(`${where}: duplicate id`);
      if (!SECTION_IDS.includes(q.section)) throw new Error(`${where}: unknown section "${q.section}"`);
      if (q.section === 'LANG1' && !['EN', 'HI'].includes(q.language)) {
        throw new Error(`${where}: LANG1 questions need "language": "EN" or "HI"`);
      }
      if (!Array.isArray(q.options) || q.options.length !== pattern.optionsPerQuestion) {
        throw new Error(`${where}: needs exactly ${pattern.optionsPerQuestion} options`);
      }
      if (!q.options.some((o) => o.key === q.answer)) throw new Error(`${where}: answer "${q.answer}" is not an option key`);
      if (!q.question || !q.explanation) throw new Error(`${where}: missing question or explanation`);
      seen.add(q.id);
      all.push(q);
    }
  }
  return all;
}

const bucketKey = (q) => (q.section === 'LANG1' ? `LANG1:${q.language}` : q.section);
const bucketsFor = (sectionId) => (sectionId === 'LANG1' ? ['LANG1:EN', 'LANG1:HI'] : [sectionId]);

function seed({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const bank = loadBank();

  const buckets = {};
  for (const q of bank) (buckets[bucketKey(q)] ||= []).push(q);
  for (const list of Object.values(buckets)) list.sort((a, b) => a.id.localeCompare(b.id));

  const upsertQuestion = db.prepare(`
    INSERT INTO questions (id, section, language, topic, difficulty, question_json, options_json, answer, explanation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET section = excluded.section, language = excluded.language, topic = excluded.topic,
      difficulty = excluded.difficulty, question_json = excluded.question_json, options_json = excluded.options_json,
      answer = excluded.answer, explanation_json = excluded.explanation_json`);
  const upsertTest = db.prepare(`
    INSERT INTO mock_tests (slug, title, type, section_id, duration_minutes, total_questions, is_published)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(slug) DO UPDATE SET title = excluded.title, type = excluded.type, section_id = excluded.section_id,
      duration_minutes = excluded.duration_minutes, total_questions = excluded.total_questions, is_published = 1
    RETURNING id`);
  const clearTestQuestions = db.prepare('DELETE FROM mock_test_questions WHERE mock_test_id = ?');
  const addTestQuestion = db.prepare('INSERT INTO mock_test_questions (mock_test_id, question_id, order_no) VALUES (?, ?, ?)');

  const slugs = [];
  function saveTest({ slug, title, type, sectionId, duration, total, questions }) {
    const { id } = upsertTest.get(slug, title, type, sectionId, duration, total);
    clearTestQuestions.run(id);
    questions.forEach((q, i) => addTestQuestion.run(id, q.id, i + 1));
    slugs.push(slug);
    log(`  ${title}: ${total} questions, ${duration} min`);
  }

  // Number of questions a candidate actually sees (LANG1 = one of EN / HI).
  const visibleCount = (sectionId, slices) =>
    sectionId === 'LANG1' ? Math.max(...slices.map((s) => s.length)) : slices[0].length;

  tx(() => {
    for (const q of bank) {
      upsertQuestion.run(
        q.id, q.section, q.language || null, q.topic || null, q.difficulty || null,
        JSON.stringify(q.question), JSON.stringify(q.options), q.answer, JSON.stringify(q.explanation),
      );
    }
    log(`Loaded ${bank.length} questions.`);

    // Full mocks: as many complete sets as the bank allows (at least one, even if partial).
    const order = pattern.fullMock.sectionOrder;
    const fullCount = Math.max(1, Math.min(...order.flatMap((sid) =>
      bucketsFor(sid).map((b) => Math.floor((buckets[b]?.length || 0) / sectionById[sid].questions)))));
    for (let i = 0; i < fullCount; i++) {
      let total = 0;
      const questions = [];
      for (const sid of order) {
        const need = sectionById[sid].questions;
        const slices = bucketsFor(sid).map((b) => (buckets[b] || []).slice(i * need, (i + 1) * need));
        total += visibleCount(sid, slices);
        questions.push(...slices.flat());
      }
      saveTest({
        slug: `full-${i + 1}`, title: `Full Mock ${i + 1}`, type: 'FULL', sectionId: null,
        duration: pattern.fullMock.durationMinutes, total, questions,
      });
    }

    // Sectional mocks: one test per full chunk of questions in each section.
    for (const section of pattern.sections) {
      const keys = bucketsFor(section.id);
      if (keys.every((b) => !buckets[b]?.length)) continue;
      const need = section.questions;
      const count = Math.max(1, Math.min(...keys.map((b) => Math.floor((buckets[b]?.length || 0) / need))));
      for (let j = 0; j < count; j++) {
        const slices = keys.map((b) => (buckets[b] || []).slice(j * need, (j + 1) * need));
        const total = visibleCount(section.id, slices);
        saveTest({
          slug: `sec-${section.id.toLowerCase()}-${j + 1}`,
          title: `${section.name.en} — Practice Test ${j + 1}`,
          type: 'SECTIONAL', sectionId: section.id,
          duration: Math.max(1, Math.round(pattern.sectional.minutesPerQuestion * total)),
          total, questions: slices.flat(),
        });
      }
    }

    // Hide tests that no longer exist in the bank (kept in DB so old attempts still resolve).
    const placeholders = slugs.map(() => '?').join(',');
    db.prepare(`UPDATE mock_tests SET is_published = 0 WHERE slug NOT IN (${placeholders})`).run(...slugs);
  });

  return { questions: bank.length, tests: slugs.length };
}

if (require.main === module) {
  try {
    const r = seed();
    console.log(`Done: ${r.questions} questions, ${r.tests} tests.`);
  } catch (err) {
    console.error(`Seed failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { seed };
