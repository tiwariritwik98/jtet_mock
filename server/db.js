const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'jtet.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  mobile        TEXT UNIQUE,
  roll_no       TEXT,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
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
  start_time       INTEGER NOT NULL,
  end_time         INTEGER NOT NULL,
  submitted_at     INTEGER,
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
  created_at  INTEGER NOT NULL
);
`);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, tx, DB_PATH };
