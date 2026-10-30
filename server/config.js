const fs = require('node:fs');
const path = require('node:path');

const pattern = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'exam-pattern.json'), 'utf8'));
const sectionById = Object.fromEntries(pattern.sections.map((s) => [s.id, s]));
const SECTION_IDS = pattern.sections.map((s) => s.id);

function needsLanguage1(test) {
  return test.type === 'FULL' || test.section_id === 'LANG1';
}

module.exports = { pattern, sectionById, SECTION_IDS, needsLanguage1 };
