// Loads data/questions/*.json into the database and (re)builds the mock tests.
// Safe to re-run: questions and tests are upserted, past attempts are untouched.
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');
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

// Number of questions a candidate actually sees (LANG1 = one of EN / HI).
const visibleCount = (sectionId, slices) =>
  sectionId === 'LANG1' ? Math.max(...slices.map((s) => s.length)) : slices[0].length;

function planTests(bank) {
  const buckets = {};
  for (const q of bank) (buckets[bucketKey(q)] ||= []).push(q);
  for (const list of Object.values(buckets)) list.sort((a, b) => a.id.localeCompare(b.id));

  const tests = [];

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
    tests.push({
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
      tests.push({
        slug: `sec-${section.id.toLowerCase()}-${j + 1}`,
        title: `${section.name.en} — Practice Test ${j + 1}`,
        type: 'SECTIONAL', sectionId: section.id,
        duration: Math.max(1, Math.round(pattern.sectional.minutesPerQuestion * total)),
        total, questions: slices.flat(),
      });
    }
  }
  return tests;
}

async function seed({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const bank = loadBank();
  const tests = planTests(bank);

  await db.tx(async (t) => {
    for (const q of bank) {
      await t.run(`
        INSERT INTO questions (id, section, language, topic, difficulty, question_json, options_json, answer, explanation_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET section = excluded.section, language = excluded.language, topic = excluded.topic,
          difficulty = excluded.difficulty, question_json = excluded.question_json, options_json = excluded.options_json,
          answer = excluded.answer, explanation_json = excluded.explanation_json`,
      q.id, q.section, q.language || null, q.topic || null, q.difficulty || null,
      JSON.stringify(q.question), JSON.stringify(q.options), q.answer, JSON.stringify(q.explanation));
    }
    log(`Loaded ${bank.length} questions.`);

    for (const test of tests) {
      const { id } = await t.get(`
        INSERT INTO mock_tests (slug, title, type, section_id, duration_minutes, total_questions, is_published)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET title = excluded.title, type = excluded.type, section_id = excluded.section_id,
          duration_minutes = excluded.duration_minutes, total_questions = excluded.total_questions, is_published = 1
        RETURNING id`,
      test.slug, test.title, test.type, test.sectionId, test.duration, test.total);
      await t.run('DELETE FROM mock_test_questions WHERE mock_test_id = ?', id);
      for (let i = 0; i < test.questions.length; i++) {
        await t.run('INSERT INTO mock_test_questions (mock_test_id, question_id, order_no) VALUES (?, ?, ?)',
          id, test.questions[i].id, i + 1);
      }
      log(`  ${test.title}: ${test.total} questions, ${test.duration} min`);
    }

    // Hide tests that no longer exist in the bank (kept in DB so old attempts still resolve).
    const slugs = tests.map((x) => x.slug);
    await t.run(`UPDATE mock_tests SET is_published = 0 WHERE slug NOT IN (${slugs.map(() => '?').join(',')})`, ...slugs);
  });

  return { questions: bank.length, tests: tests.length };
}

if (require.main === module) {
  (async () => {
    try {
      await db.init();
      const r = await seed();
      console.log(`Done: ${r.questions} questions, ${r.tests} tests.`);
    } catch (err) {
      console.error(`Seed failed: ${err.message}`);
      process.exitCode = 1;
    } finally {
      await db.close();
    }
  })();
}

module.exports = { seed };
