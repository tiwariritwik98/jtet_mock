const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { ZodError } = require('zod');
const { db } = require('./db');
const { pattern } = require('./config');
const { seed } = require('./seed');
const { identifyCandidate } = require('./middleware/candidate');
const { startAutoSubmitJob } = require('./jobs/autoSubmit');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render's proxy: real client IP for rate limiting
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

app.get('/api/config', (req, res) => {
  res.json({
    title: pattern.title,
    marking: pattern.marking,
    fullMock: pattern.fullMock,
    sectional: pattern.sectional,
    cutoffs: pattern.cutoffs,
    timerWarningsMinutes: pattern.timerWarningsMinutes,
    timerRedZoneMinutes: pattern.timerRedZoneMinutes,
    sections: pattern.sections.map((s) => ({ id: s.id, name: s.name, questions: s.questions, marks: s.marks })),
  });
});
app.use('/api', identifyCandidate, require('./routes/tests'), require('./routes/attempts'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input.' });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

(async () => {
  await db.init();
  // Keep the database in sync with data/questions on every start (idempotent; attempts are untouched).
  await seed({ quiet: true }).then((r) => console.log(`Question bank: ${r.questions} questions, ${r.tests} tests.`));
  startAutoSubmitJob();
  app.listen(PORT, () => {
    console.log(`JTET Mock Portal running at http://localhost:${PORT}`);
    console.log(`Database: ${db.label}`);
  });
})().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
