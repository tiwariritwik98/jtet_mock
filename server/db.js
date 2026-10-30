// Database adapter with one async API over two backends:
//   - PostgreSQL when DATABASE_URL is set (production, e.g. Neon on Render)
//   - SQLite (Node's built-in node:sqlite) otherwise, for zero-setup local use
// SQL is written with `?` placeholders and portable syntax; the adapter converts for Postgres.
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  mobile        TEXT UNIQUE,
  roll_no       TEXT,
  password_hash TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id               TEXT PRIMARY KEY,
  section          TEXT NOT NULL,
  language         TEXT,
  topic            TEXT,
  difficulty       TEXT,
  question_json    TEXT NOT NULL,
  options_json     TEXT NOT NULL,
  answer           TEXT NOT NULL,
  explanation_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_tests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('FULL', 'SECTIONAL')),
  section_id       TEXT,
  duration_minutes INTEGER NOT NULL,
  total_questions  INTEGER NOT NULL,
  is_published     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mock_test_questions (
  mock_test_id INTEGER NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL REFERENCES questions(id),
  order_no     INTEGER NOT NULL,
  PRIMARY KEY (mock_test_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  mock_test_id     INTEGER NOT NULL REFERENCES mock_tests(id),
  language1_choice TEXT,
  status           TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED')),
  start_time       BIGINT NOT NULL,
  end_time         BIGINT NOT NULL,
  submitted_at     BIGINT,
  submit_type      TEXT CHECK (submit_type IN ('MANUAL', 'AUTO')),
  total_questions  INTEGER NOT NULL,
  score            INTEGER,
  correct_count    INTEGER,
  wrong_count      INTEGER,
  skipped_count    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status, end_time);

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id           INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id          TEXT NOT NULL REFERENCES questions(id),
  order_no             INTEGER NOT NULL,
  section              TEXT NOT NULL,
  selected_option      TEXT,
  is_marked_for_review INTEGER NOT NULL DEFAULT 0,
  visited              INTEGER NOT NULL DEFAULT 0,
  time_spent_seconds   INTEGER NOT NULL DEFAULT 0,
  is_correct           INTEGER,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS question_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  attempt_id  INTEGER,
  message     TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
`;

function createPostgres(connectionString) {
  const { Pool, types } = require('pg');
  // BIGINT (epoch-ms timestamps, COUNT/SUM results) as JS numbers instead of strings.
  types.setTypeParser(20, Number);
  types.setTypeParser(1700, Number);

  const pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX) || 5 });
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const wrap = (c) => ({
    get: async (sql, ...p) => (await c.query(toPg(sql), p)).rows[0],
    all: async (sql, ...p) => (await c.query(toPg(sql), p)).rows,
    run: async (sql, ...p) => ({ changes: (await c.query(toPg(sql), p)).rowCount }),
  });

  return {
    kind: 'postgres',
    label: `PostgreSQL (${new URL(connectionString).host})`,
    ...wrap(pool),
    async init() {
      await pool.query(SCHEMA.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY'));
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function createSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const q = {
    get: async (sql, ...p) => conn.prepare(sql).get(...p),
    all: async (sql, ...p) => conn.prepare(sql).all(...p),
    run: async (sql, ...p) => ({ changes: Number(conn.prepare(sql).run(...p).changes) }),
  };

  return {
    kind: 'sqlite',
    label: `SQLite (${file})`,
    ...q,
    async init() { conn.exec(SCHEMA); },
    // node:sqlite is synchronous, so the awaits inside fn resolve as microtasks and no other
    // request can interleave with an open transaction.
    async tx(fn) {
      conn.exec('BEGIN');
      try {
        const result = await fn(q);
        conn.exec('COMMIT');
        return result;
      } catch (err) {
        conn.exec('ROLLBACK');
        throw err;
      }
    },
    close: async () => conn.close(),
  };
}

const db = process.env.DATABASE_URL
  ? createPostgres(process.env.DATABASE_URL)
  : createSqlite(path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'jtet.db')));

module.exports = { db };
