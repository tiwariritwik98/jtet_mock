// Loads data/questions/*.json into the database and (re)builds the mock tests.
// Safe to re-run: questions and tests are upserted, past attempts are untouched.
const { db } = require('./db');
const { loadBank, planTests } = require('./lib/bank');

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
