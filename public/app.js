'use strict';

/* =============================================================================================
   JTET Mock Portal — single-page frontend (hash routing, no build step)
   ============================================================================================= */

const app = document.getElementById('app');
const state = { user: null, config: null };
let exam = null;     // active exam session (see pageExam)
let solView = null;  // active solution review (see pageSolutions)

// ---------- helpers ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, '0');

const pref = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function hms(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
function humanDuration(sec) {
  if (sec == null) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
const fmtDate = (ms) => new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Text in the chosen language, falling back to whatever exists (language sections are monolingual).
const txt = (obj, lang) => (obj ? obj[lang] ?? obj.en ?? obj.hi ?? '' : '');

function sectionName(id, lang = 'en') {
  const s = state.config?.sections.find((x) => x.id === id);
  return s ? txt(s.name, lang) : id;
}
const SHORT_SECTION = { CDP: 'CDP', MATH_SCI: 'Maths & Sci', COMPUTER: 'Computer', LANG1: 'Lang-1', LANG2: 'Lang-2' };

// The static (GitHub Pages) build provides window.LocalApi; the server build talks to /api.
const STATIC_MODE = !!window.LocalApi;
const api = STATIC_MODE ? window.LocalApi.call : fetchApi;

async function fetchApi(path, { method = 'GET', body, keepalive } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      keepalive,
    });
  } catch {
    const e = new Error('Network error — check your connection.');
    e.network = true;
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 4000);
}

function modal(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  return { el: wrap, close };
}

const loading = () => { app.innerHTML = '<div class="loading">Loading…</div>'; };

function shell(content) {
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/dashboard">JTET Mock Portal<span>Level 2</span></a>
      <div class="topbar-right">
        <a class="btn btn-sm" href="#/full-mock">Full Mock</a>
        <a class="btn btn-sm" href="#/sectional">Sectional</a>
      </div>
    </header>
    <main class="container">${content}</main>
    <footer class="footer">Independent practice portal — not affiliated with the Jharkhand Academic Council (JAC).</footer>`;
  window.scrollTo(0, 0);
}

function showError(err) {
  shell(`<div class="card error-card"><h2 style="margin-top:0">Something went wrong</h2>
    <p>${esc(err.message)}</p><a class="btn" href="#/dashboard">← Back to home</a></div>`);
}

function bindForm(form, handler) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('.form-error', form);
    const btn = $('button[type=submit]', form);
    err.textContent = '';
    btn.disabled = true;
    const data = {};
    for (const [k, v] of new FormData(form)) {
      const val = String(v).trim();
      if (val !== '') data[k] = val;
    }
    try { await handler(data); } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
  });
}

// ---------- router ---------------------------------------------------------------------------

const routes = [
  { re: /^#\/dashboard$/, page: pageDashboard },
  { re: /^#\/full-mock$/, page: pageFullMock },
  { re: /^#\/sectional$/, page: pageSectional },
  { re: /^#\/sectional\/([A-Z_0-9]+)$/, page: pageSectionTests },
  { re: /^#\/instructions\/(\d+)$/, page: pageInstructions },
  { re: /^#\/exam\/(\d+)$/, page: pageExam },
  { re: /^#\/result\/(\d+)$/, page: pageResult },
  { re: /^#\/solutions\/(\d+)$/, page: pageSolutions },
];

async function router() {
  leaveExam();
  solView = null;
  const hash = location.hash || '#/dashboard';
  const route = routes.find((r) => r.re.test(hash));
  if (!route) { location.hash = '#/dashboard'; return; }
  try {
    await route.page(...hash.match(route.re).slice(1));
  } catch (e) {
    showError(e);
  }
}

window.addEventListener('hashchange', router);

(async function init() {
  try {
    state.config = await api('/config');
  } catch (e) {
    app.innerHTML = `<main class="container"><div class="card error-card">Cannot reach the server: ${esc(e.message)}</div></main>`;
    return;
  }
  router();
})();

// ---------- dashboard -------------------------------------------------------------------------

async function pageDashboard() {
  loading();
  const { stats, attempts } = await api('/me/attempts');
  const fm = state.config.fullMock;
  const pct = (v) => (v == null ? '—' : `${v}%`);

  const rows = attempts.map((a) => {
    const done = a.status === 'SUBMITTED';
    return `<tr>
      <td>${esc(a.title)} ${a.type === 'FULL' ? '<span class="badge badge-blue">Full</span>' : '<span class="badge badge-grey">Sectional</span>'}</td>
      <td>${fmtDate(a.startedAt)}</td>
      <td class="num">${done ? `<b>${a.score}</b> / ${a.total}` : '—'}</td>
      <td>${done ? humanDuration(a.timeTakenSeconds) + (a.submitType === 'AUTO' ? ' <span class="badge badge-amber">Auto</span>' : '') : '<span class="badge badge-amber">In progress</span>'}</td>
      <td><div class="btn-row">${done
        ? `<a class="btn btn-sm" href="#/result/${a.id}">View Result</a><a class="btn btn-sm" href="#/solutions/${a.id}">View Solutions</a>`
        : `<a class="btn btn-sm btn-primary" href="#/exam/${a.id}">Resume</a>`}</div></td>
    </tr>`;
  }).join('');

  shell(`
    <h1>JTET Level 2 Mock Tests</h1>
    <p class="muted">Paper II · Class 6 to 8 · No login needed — your attempts are saved in this browser.</p>
    <div class="mode-cards" style="margin-top:0">
      <a class="mode-card" href="#/full-mock">
        <span class="tag">A</span><h2>Full Mock</h2>
        <p>${fm.totalQuestions} questions · ${fm.durationMinutes} min · all 5 sections, exactly like the real exam</p>
      </a>
      <a class="mode-card" href="#/sectional">
        <span class="tag">B</span><h2>Sectional Mock</h2>
        <p>Practise one section at a time · 1 min per question</p>
      </a>
    </div>
    <h2>Your progress</h2>
    <div class="stats">
      <div class="stat"><div class="label">Tests attempted</div><div class="value">${stats.attempted}</div></div>
      <div class="stat"><div class="label">Best score</div><div class="value">${pct(stats.bestPercentage)}</div></div>
      <div class="stat"><div class="label">Average score</div><div class="value">${pct(stats.averagePercentage)}</div></div>
    </div>
    <h2>Attempt History</h2>
    <div class="table-wrap">${attempts.length
      ? `<table><thead><tr><th>Test</th><th>Date</th><th class="num">Score</th><th>Time taken</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="empty">No attempts yet. Start a Full Mock or a Sectional Mock above.</div>'}</div>`);
}

// ---------- test lists ------------------------------------------------------------------------

function statusBadge(t) {
  if (t.status === 'IN_PROGRESS') return '<span class="badge badge-amber">In Progress</span>';
  if (t.status === 'COMPLETED') return '<span class="badge badge-green">Completed</span>';
  return '<span class="badge badge-grey">Not Attempted</span>';
}

function testItem(t) {
  const actions = [];
  if (t.inProgressAttemptId) actions.push(`<a class="btn btn-primary" href="#/exam/${t.inProgressAttemptId}">Resume</a>`);
  else actions.push(`<a class="btn btn-primary" href="#/instructions/${t.id}">${t.status === 'COMPLETED' ? 'Re-attempt' : 'Start'}</a>`);
  if (t.lastAttempt) actions.push(`<a class="btn" href="#/result/${t.lastAttempt.id}">Last result: ${t.lastAttempt.score}/${t.lastAttempt.total}</a>`);
  return `<div class="card test-item">
    <div><h3>${esc(t.title)}</h3>
      <div class="muted small">${t.totalQuestions} questions · ${t.durationMinutes} min · ${statusBadge(t)}</div></div>
    <div class="btn-row">${actions.join('')}</div>
  </div>`;
}

async function pageFullMock() {
  loading();
  const { tests } = await api('/tests?type=FULL');
  const order = state.config.fullMock.sectionOrder.map((id) => sectionName(id)).join(' → ');
  shell(`
    <div class="crumbs"><a href="#/dashboard">Home</a> / Full Mock</div>
    <h1>A. Full Mock</h1>
    <p class="muted">${state.config.fullMock.totalQuestions} questions in ${state.config.fullMock.durationMinutes} minutes. Section order: ${esc(order)}.</p>
    <div class="test-list">${tests.map(testItem).join('') || '<div class="card empty">No full mocks published yet.</div>'}</div>`);
}

function pageSectional() {
  const mpq = state.config.sectional.minutesPerQuestion;
  shell(`
    <div class="crumbs"><a href="#/dashboard">Home</a> / Sectional Mock</div>
    <h1>B. Sectional Mock</h1>
    <p class="muted">Pick a section to practise. Time = ${mpq} min per question.</p>
    <div class="section-grid">${state.config.sections.map((s) => `
      <a class="card section-card" href="#/sectional/${s.id}">
        <h3>${esc(s.name.en)}</h3>
        <div class="muted small">${esc(s.name.hi)}</div>
        <div class="small" style="margin-top:.5rem">${s.questions} Q · ${Math.round(s.questions * mpq)} min</div>
      </a>`).join('')}</div>`);
}

async function pageSectionTests(sectionId) {
  loading();
  const { tests } = await api(`/tests?type=SECTIONAL&section=${encodeURIComponent(sectionId)}`);
  shell(`
    <div class="crumbs"><a href="#/dashboard">Home</a> / <a href="#/sectional">Sectional Mock</a> / ${esc(sectionName(sectionId))}</div>
    <h1>${esc(sectionName(sectionId))}</h1>
    <div class="test-list">${tests.map(testItem).join('') || '<div class="card empty">No tests in this section yet.</div>'}</div>`);
}

// ---------- instructions ----------------------------------------------------------------------

const LEGEND = `
  <div><span class="pcell sm not-visited"></span> Not visited</div>
  <div><span class="pcell sm not-answered"></span> Not answered</div>
  <div><span class="pcell sm answered"></span> Answered</div>
  <div><span class="pcell sm marked"></span> Marked for review</div>
  <div><span class="pcell sm answered-marked"></span> Answered &amp; marked (will be evaluated)</div>`;

async function pageInstructions(testId) {
  loading();
  const { test: t } = await api(`/tests/${testId}`);
  if (t.inProgressAttemptId) { location.hash = `#/exam/${t.inProgressAttemptId}`; return; }
  const back = t.type === 'FULL' ? '#/full-mock' : `#/sectional/${t.sectionId}`;
  const saved = pref.get('lang1', 'EN');

  shell(`
    <div class="crumbs"><a href="#/dashboard">Home</a> / <a href="${back}">${t.type === 'FULL' ? 'Full Mock' : esc(sectionName(t.sectionId))}</a> / Instructions</div>
    <div class="card">
      <h1>${esc(t.title)}</h1>
      <ul class="facts">
        <li><b>${t.totalQuestions}</b> questions</li>
        <li><b>${t.durationMinutes}</b> minutes</li>
        <li>+${state.config.marking.correct} per correct answer</li>
        <li>No negative marking</li>
      </ul>
      ${t.sections.length > 1 ? `<h3>Sections</h3><div class="table-wrap"><table><thead><tr><th>Section</th><th class="num">Questions</th></tr></thead><tbody>
        ${t.sections.map((s) => `<tr><td>${esc(txt(s.name, 'en'))}</td><td class="num">${s.count}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <h3>Instructions</h3>
      <ol>
        <li>The timer starts as soon as you click <b>Start Test</b> and runs on the server — closing the browser does <b>not</b> pause it.</li>
        <li>The test is <b>submitted automatically</b> when the time runs out.</li>
        <li>Each question has 4 options with exactly one correct answer. Click an option to select it; it is saved instantly.</li>
        <li><b>Save &amp; Next</b> moves to the next question. <b>Mark for Review &amp; Next</b> flags the question to revisit. <b>Clear Response</b> removes your answer.</li>
        <li>You can move freely between sections using the section tabs and the question palette.</li>
        <li>Answers and solutions are shown <b>only after you submit</b>.</li>
        <li>Use the <b>EN | हिं</b> toggle to switch the language of non-language sections.</li>
      </ol>
      <h3>Question palette</h3>
      <div class="legend">${LEGEND}</div>
      ${t.needsLanguage1 ? `
        <h3>Choose Language-1</h3>
        <div class="lang-choice">
          <label><input type="radio" name="lang1" value="EN" ${saved === 'EN' ? 'checked' : ''}> English</label>
          <label><input type="radio" name="lang1" value="HI" ${saved === 'HI' ? 'checked' : ''}> Hindi / हिन्दी</label>
        </div>
        ${t.type === 'FULL' ? '<p class="muted small">Language-2 is fixed as Khortha.</p>' : ''}` : ''}
      <hr style="border:0;border-top:1px solid var(--border);margin:1.25rem 0">
      <label class="check"><input type="checkbox" id="agree"> I have read and understood the instructions.</label>
      <div class="form-error" id="startErr"></div>
      <div class="btn-row" style="margin-top:.5rem">
        <button class="btn btn-primary" id="startBtn" disabled>Start Test</button>
        <a class="btn" href="${back}">Cancel</a>
      </div>
    </div>`);

  $('#agree').onchange = (e) => { $('#startBtn').disabled = !e.target.checked; };
  $('#startBtn').onclick = async () => {
    const btn = $('#startBtn');
    btn.disabled = true;
    const lang = $('input[name=lang1]:checked')?.value;
    if (lang) pref.set('lang1', lang);
    try {
      const r = await api('/attempts', { method: 'POST', body: { mockTestId: t.id, language1Choice: lang } });
      location.hash = `#/exam/${r.attemptId}`;
    } catch (e) {
      $('#startErr').textContent = e.message;
      btn.disabled = false;
    }
  };
}

// ---------- exam (CBT) ------------------------------------------------------------------------

function qStatus(q) {
  if (!q.visited) return 'not-visited';
  if (q.marked && q.selected) return 'answered-marked';
  if (q.marked) return 'marked';
  if (q.selected) return 'answered';
  return 'not-answered';
}

async function pageExam(attemptId) {
  loading();
  const data = await api(`/attempts/${attemptId}`);
  if (data.status === 'SUBMITTED') { location.hash = `#/result/${attemptId}`; return; }

  const firstUnvisited = data.questions.findIndex((q) => !q.visited);
  const warnings = [...(state.config.timerWarningsMinutes || [10, 5])].sort((a, b) => b - a);
  exam = {
    ...data,
    current: -1,
    lang: pref.get('examLang', 'en'),
    endAt: Date.now() + data.remainingSeconds * 1000,
    qStart: Date.now(),
    queue: Promise.resolve(),
    finishing: false,
    // Warnings already in the past at load time are not re-announced.
    warned: new Set(warnings.filter((m) => data.remainingSeconds <= m * 60)),
    warnings,
  };

  app.innerHTML = `
    <div class="exam" id="exam">
      <header class="exam-top">
        <div class="exam-title">JTET Level 2 – ${esc(exam.test.title)}</div>
        <div class="timer" id="timer" title="Time left">--:--:--</div>
      </header>
      <div class="exam-bar">
        <div class="sec-tabs" id="secTabs"></div>
        <div class="lang-toggle" id="langToggle">
          <button data-lang="en">EN</button><button data-lang="hi">हिं</button>
        </div>
      </div>
      <div class="exam-body">
        <section class="q-pane" id="qPane"></section>
        <aside class="palette-pane" id="palette"></aside>
      </div>
      <footer class="exam-actions">
        <button class="btn" id="markNext">Mark for Review &amp; Next</button>
        <button class="btn" id="clearBtn">Clear Response</button>
        <button class="btn palette-toggle" id="paletteToggle">Palette</button>
        <span class="spacer"></span>
        <button class="btn" id="prevBtn">◀ Previous</button>
        <button class="btn btn-success" id="saveNext">Save &amp; Next ▶</button>
        <button class="btn btn-danger" id="submitBtn">Submit</button>
      </footer>
    </div>`;

  const root = $('#exam');
  // Soft deterrents against copying (README §4.5).
  for (const ev of ['contextmenu', 'copy', 'cut', 'selectstart']) root.addEventListener(ev, (e) => e.preventDefault());

  $('#langToggle').onclick = (e) => {
    const lang = e.target.dataset.lang;
    if (!lang) return;
    exam.lang = lang;
    pref.set('examLang', lang);
    renderExam();
  };
  $('#secTabs').onclick = (e) => {
    const sid = e.target.dataset.section;
    if (sid) goTo(exam.questions.findIndex((q) => q.section === sid));
  };
  $('#palette').onclick = (e) => {
    const i = e.target.closest('[data-idx]')?.dataset.idx;
    if (i != null) { goTo(Number(i)); $('#palette').classList.remove('open'); }
  };
  $('#qPane').onclick = (e) => {
    const opt = e.target.closest('[data-key]');
    if (!opt) return;
    const q = exam.questions[exam.current];
    q.selected = opt.dataset.key;
    save(q, { selectedOption: q.selected });
    renderExam();
  };
  $('#saveNext').onclick = () => {
    const q = exam.questions[exam.current];
    if (q.marked) { q.marked = false; save(q, { markedForReview: false }); }
    next();
  };
  $('#markNext').onclick = () => {
    const q = exam.questions[exam.current];
    q.marked = true;
    save(q, { markedForReview: true });
    next();
  };
  $('#clearBtn').onclick = () => {
    const q = exam.questions[exam.current];
    if (!q.selected) return;
    q.selected = null;
    save(q, { selectedOption: null });
    renderExam();
  };
  $('#prevBtn').onclick = () => { if (exam.current > 0) goTo(exam.current - 1); };
  $('#paletteToggle').onclick = () => $('#palette').classList.toggle('open');
  $('#submitBtn').onclick = confirmSubmit;

  window.addEventListener('pagehide', onPageHide);
  exam.timer = setInterval(tick, 1000);
  tick();
  goTo(firstUnvisited === -1 ? 0 : firstUnvisited);
}

function onPageHide() {
  if (exam && !exam.finishing) flushTime(true);
}

function leaveExam() {
  if (!exam) return;
  clearInterval(exam.timer);
  window.removeEventListener('pagehide', onPageHide);
  if (!exam.finishing) flushTime();
  exam = null;
}

// Serialised auto-save with a few retries for flaky networks.
function save(q, patch, { keepalive = false } = {}) {
  const ex = exam;
  const body = { questionId: q.id, ...patch };
  ex.queue = ex.queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api(`/attempts/${ex.id}/answers`, { method: 'PUT', body, keepalive });
        return;
      } catch (e) {
        if (e.status === 409) { if (exam === ex) finishExam('timeup'); return; }
        if (e.status === 401) { showError(e); return; }
        if (!e.network || attempt === 2) { toast(`Answer not saved: ${e.message}`, 'error'); return; }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  });
  return ex.queue;
}

function flushTime(keepalive = false) {
  const q = exam.questions[exam.current];
  if (!q) return;
  const secs = Math.round((Date.now() - exam.qStart) / 1000);
  exam.qStart = Date.now();
  if (secs > 0) save(q, { timeSpentSeconds: Math.min(secs, 3600) }, { keepalive });
}

function goTo(i) {
  if (i < 0 || i >= exam.questions.length) return;
  if (exam.current >= 0) flushTime();
  exam.current = i;
  exam.qStart = Date.now();
  const q = exam.questions[i];
  if (!q.visited) { q.visited = true; save(q, { visited: true }); }
  renderExam();
  $('#qPane').scrollTop = 0;
}

function next() {
  if (exam.current < exam.questions.length - 1) goTo(exam.current + 1);
  else { renderExam(); toast('This is the last question. Review using the palette, then Submit.'); }
}

function renderExam() {
  const q = exam.questions[exam.current];
  const lang = exam.lang;

  $$('#langToggle button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  $('#secTabs').innerHTML = exam.sections.map((s) =>
    `<button class="sec-tab ${s.id === q.section ? 'active' : ''}" data-section="${s.id}">${esc(SHORT_SECTION[s.id] || s.id)}</button>`).join('');

  $('#qPane').innerHTML = `
    <div class="q-head">
      <span class="q-no">Question ${q.no}</span>
      <span class="badge badge-blue">${esc(sectionName(q.section, lang))}</span>
    </div>
    <div class="q-text">${esc(txt(q.question, lang))}</div>
    <div class="options" role="radiogroup">${q.options.map((o) => `
      <div class="option ${q.selected === o.key ? 'selected' : ''}" data-key="${o.key}" role="radio" aria-checked="${q.selected === o.key}" tabindex="0">
        <input type="radio" ${q.selected === o.key ? 'checked' : ''} tabindex="-1" style="pointer-events:none">
        <span><span class="key">${o.key})</span> ${esc(txt(o, lang))}</span>
      </div>`).join('')}</div>`;

  const inSection = exam.questions.map((x, idx) => ({ x, idx })).filter(({ x }) => x.section === q.section);
  const counts = { answered: 0, 'not-answered': 0, marked: 0, 'answered-marked': 0, 'not-visited': 0 };
  for (const { x } of inSection) counts[qStatus(x)]++;

  $('#palette').innerHTML = `
    <h4>${esc(sectionName(q.section, lang))}</h4>
    <div class="palette-counts">
      <div><span class="pcell sm answered">${counts.answered}</span> Answered</div>
      <div><span class="pcell sm not-answered">${counts['not-answered']}</span> Not answered</div>
      <div><span class="pcell sm marked">${counts.marked}</span> Marked</div>
      <div><span class="pcell sm answered-marked">${counts['answered-marked']}</span> Ans. &amp; marked</div>
      <div><span class="pcell sm not-visited">${counts['not-visited']}</span> Not visited</div>
    </div>
    <div class="palette-grid">${inSection.map(({ x, idx }) =>
      `<button class="pcell ${qStatus(x)} ${idx === exam.current ? 'current' : ''}" data-idx="${idx}" title="Question ${x.no}">${x.no}</button>`).join('')}</div>
    <div class="palette-legend">${LEGEND}</div>`;

  $('#prevBtn').disabled = exam.current === 0;
}

function tick() {
  if (!exam) return;
  const left = Math.round((exam.endAt - Date.now()) / 1000);
  const el = $('#timer');
  el.textContent = hms(left);
  el.classList.toggle('danger', left <= (state.config.timerRedZoneMinutes ?? 5) * 60);
  for (const m of exam.warnings) {
    if (left <= m * 60 && left > 0 && !exam.warned.has(m)) {
      exam.warned.add(m);
      toast(`⏰ ${m} minutes left!`, 'warn');
    }
  }
  if (left <= 0) finishExam('timeup');
}

function confirmSubmit() {
  const rows = exam.sections.map((s) => {
    const list = exam.questions.filter((q) => q.section === s.id);
    const st = list.map(qStatus);
    const answered = st.filter((x) => x === 'answered' || x === 'answered-marked').length;
    return `<tr><td>${esc(SHORT_SECTION[s.id] || s.id)}</td><td class="num">${list.length}</td><td class="num">${answered}</td>
      <td class="num">${st.filter((x) => x === 'not-answered').length}</td>
      <td class="num">${st.filter((x) => x === 'marked' || x === 'answered-marked').length}</td>
      <td class="num">${st.filter((x) => x === 'not-visited').length}</td></tr>`;
  }).join('');
  const m = modal(`
    <h2>Submit test?</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Section</th><th class="num">Total</th><th class="num">Answered</th><th class="num">Not answered</th><th class="num">Marked</th><th class="num">Not visited</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="muted small">Time left: ${hms((exam.endAt - Date.now()) / 1000)}. After submitting you cannot change any answer.</p>
    <div class="btn-row" style="justify-content:flex-end">
      <button class="btn" data-act="cancel">Back to test</button>
      <button class="btn btn-danger" data-act="submit">Yes, submit</button>
    </div>`);
  m.el.onclick = (e) => {
    const act = e.target.dataset.act;
    if (act === 'cancel') m.close();
    if (act === 'submit') { m.close(); finishExam('manual'); }
  };
}

async function finishExam(reason) {
  if (!exam || exam.finishing) return;
  const ex = exam;
  ex.finishing = true;
  clearInterval(ex.timer);
  flushTime();
  $('#exam')?.insertAdjacentHTML('beforeend', '<div class="modal-backdrop"><div class="modal"><h2>Submitting…</h2><p class="muted">Please wait.</p></div></div>');
  await ex.queue;
  try {
    await api(`/attempts/${ex.id}/submit`, { method: 'POST' });
  } catch (e) {
    if (e.network) {
      // The server auto-submits on its own clock anyway; let the result page retry.
      toast('Network issue while submitting — your answers are saved and the test will be submitted by the server.', 'error');
    }
  }
  if (reason === 'timeup') toast('Time is up! Your test was submitted automatically.', 'warn');
  else toast('Test submitted.', 'success');
  location.hash = `#/result/${ex.id}`;
}

// ---------- result ----------------------------------------------------------------------------

async function pageResult(attemptId) {
  loading();
  let r;
  try {
    r = await api(`/attempts/${attemptId}/result`);
  } catch (e) {
    if (e.status === 403) { location.hash = `#/exam/${attemptId}`; return; }
    throw e;
  }

  const sectionRows = r.sections.map((s) => `<tr>
    <td>${esc(txt(s.name, 'en'))}</td><td class="num">${s.count}</td><td class="num">${s.attempted}</td>
    <td class="num">${s.correct}</td><td class="num">${s.wrong}</td><td class="num">${s.skipped}</td>
    <td class="num"><b>${s.score}</b> / ${s.maxMarks}</td><td class="num">${s.accuracy}%</td>
    <td class="num">${humanDuration(s.timeSeconds)}</td></tr>`).join('');

  const slowRows = r.slowest.map((s) => `<tr>
    <td>Q.${s.no}</td><td>${esc(SHORT_SECTION[s.section] || s.section)}</td><td>${esc(s.topic || '—')}</td>
    <td class="num">${humanDuration(s.timeSeconds)}</td>
    <td>${s.status === 'CORRECT' ? '<span class="badge badge-green">Correct</span>' : s.status === 'WRONG' ? '<span class="badge badge-red">Wrong</span>' : '<span class="badge badge-grey">Skipped</span>'}</td></tr>`).join('');

  const cut = r.cutoffs.map((c) => `<span class="badge ${c.qualified ? 'badge-green' : 'badge-red'}">
    ${esc(c.category.charAt(0) + c.category.slice(1).toLowerCase())} (${c.cutoff}%): ${c.qualified ? 'Qualified' : 'Not qualified'}</span>`).join(' ');

  shell(`
    <div class="crumbs"><a href="#/dashboard">Home</a> / Result</div>
    <h1>${esc(r.test.title)} — Result</h1>
    <div class="card result-hero">
      <div class="score-ring" style="--pct:${Math.min(100, r.percentage)}">
        <div><div class="big">${r.score}</div><div class="of">out of ${r.maxMarks}</div></div>
      </div>
      <div>
        <div style="font-size:1.5rem;font-weight:800">${r.percentage}%</div>
        <div class="btn-row" style="margin-top:.35rem">${cut}</div>
        <div class="kv">
          <div><div class="k">Correct</div><div class="v" style="color:var(--success)">${r.correct}</div></div>
          <div><div class="k">Wrong</div><div class="v" style="color:var(--danger)">${r.wrong}</div></div>
          <div><div class="k">Skipped</div><div class="v">${r.skipped}</div></div>
          <div><div class="k">Accuracy</div><div class="v">${r.correct + r.wrong ? Math.round((r.correct / (r.correct + r.wrong)) * 1000) / 10 : 0}%</div></div>
          <div><div class="k">Time taken</div><div class="v">${humanDuration(r.timeTakenSeconds)} / ${humanDuration(r.durationSeconds)}</div></div>
          <div><div class="k">Submitted</div><div class="v">${r.submitType === 'AUTO' ? 'Auto (time up)' : 'Manually'}</div></div>
        </div>
      </div>
    </div>
    <div class="btn-row" style="margin-top:1rem">
      <a class="btn btn-primary" href="#/solutions/${r.id}">View Solutions →</a>
      <a class="btn" href="#/dashboard">Home</a>
    </div>
    <h2>Section-wise performance</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Section</th><th class="num">Questions</th><th class="num">Attempted</th><th class="num">Correct</th><th class="num">Wrong</th><th class="num">Skipped</th><th class="num">Score</th><th class="num">Accuracy</th><th class="num">Time</th></tr></thead>
      <tbody>${sectionRows}</tbody></table></div>
    <h2>Slowest questions</h2>
    <div class="table-wrap">${slowRows
      ? `<table><thead><tr><th>Question</th><th>Section</th><th>Topic</th><th class="num">Time spent</th><th>Result</th></tr></thead><tbody>${slowRows}</tbody></table>`
      : '<div class="empty">No timing data recorded.</div>'}</div>
    <p class="muted small">Cut-offs are indicative and configurable — check the official JAC notification.</p>`);
}

// ---------- solutions -------------------------------------------------------------------------

const FILTERS = [
  ['all', 'All'], ['CORRECT', 'Correct'], ['WRONG', 'Wrong'], ['SKIPPED', 'Skipped'], ['marked', 'Marked for review'],
];

async function pageSolutions(attemptId) {
  loading();
  let d;
  try {
    d = await api(`/attempts/${attemptId}/solutions`);
  } catch (e) {
    if (e.status === 403) {
      toast('Solutions unlock only after you submit the test.', 'warn');
      location.hash = `#/exam/${attemptId}`;
      return;
    }
    throw e;
  }
  solView = { d, filter: 'all', section: 'all', pos: 0, lang: pref.get('examLang', 'en') };

  shell(`
    <div class="crumbs"><a href="#/dashboard">Home</a> / <a href="#/result/${d.id}">Result</a> / Solutions</div>
    <h1>${esc(d.test.title)} — Solutions</h1>
    <p class="muted">Score ${d.score} / ${d.total}</p>
    <div class="filters" id="solFilters"></div>
    <div class="sol-layout">
      <div class="card" id="solCard"></div>
      <aside class="card"><h4 style="margin:0 0 .6rem">Questions</h4><div class="sol-palette" id="solPalette"></div></aside>
    </div>`);

  $('#solFilters').onclick = (e) => {
    const f = e.target.dataset.filter;
    const lang = e.target.dataset.lang;
    if (f) { solView.filter = f; solView.pos = 0; }
    if (lang) { solView.lang = lang; pref.set('examLang', lang); }
    if (f || lang) renderSolutions();
  };
  $('#solFilters').onchange = (e) => {
    if (e.target.id === 'solSection') { solView.section = e.target.value; solView.pos = 0; renderSolutions(); }
  };
  $('#solPalette').onclick = (e) => {
    const p = e.target.dataset.pos;
    if (p != null) { solView.pos = Number(p); renderSolutions(); }
  };
  $('#solCard').onclick = async (e) => {
    const act = e.target.dataset.act;
    if (act === 'prev') { solView.pos--; renderSolutions(); }
    if (act === 'next') { solView.pos++; renderSolutions(); }
    if (act === 'report') reportQuestion(e.target.dataset.qid);
  };
  renderSolutions();
}

function filteredSolutions() {
  const { d, filter, section } = solView;
  return d.questions.filter((q) =>
    (section === 'all' || q.section === section) &&
    (filter === 'all' || (filter === 'marked' ? q.marked : q.status === filter)));
}

function renderSolutions() {
  const { d, filter, section, lang } = solView;
  const list = filteredSolutions();
  solView.pos = Math.max(0, Math.min(solView.pos, list.length - 1));

  const count = (f) => d.questions.filter((q) => (section === 'all' || q.section === section) &&
    (f === 'all' || (f === 'marked' ? q.marked : q.status === f))).length;
  $('#solFilters').innerHTML = `
    ${FILTERS.map(([k, label]) => `<button class="chip ${filter === k ? 'active' : ''}" data-filter="${k}">${label} (${count(k)})</button>`).join('')}
    <select id="solSection" aria-label="Section">
      <option value="all">All sections</option>
      ${d.sections.map((s) => `<option value="${s.id}" ${section === s.id ? 'selected' : ''}>${esc(txt(s.name, 'en'))}</option>`).join('')}
    </select>
    <span class="lang-toggle" style="margin-left:auto">
      <button data-lang="en" class="${lang === 'en' ? 'active' : ''}">EN</button><button data-lang="hi" class="${lang === 'hi' ? 'active' : ''}">हिं</button>
    </span>`;

  $('#solPalette').innerHTML = list.map((q, i) =>
    `<button class="pcell ${q.status.toLowerCase()} ${i === solView.pos ? 'current' : ''}" data-pos="${i}" title="Q.${q.no}">${q.no}</button>`).join('')
    || '<span class="muted small">None</span>';

  const q = list[solView.pos];
  if (!q) { $('#solCard').innerHTML = '<div class="empty">No questions match this filter.</div>'; return; }

  const optText = (key) => {
    const o = q.options.find((x) => x.key === key);
    return o ? `${key}) ${txt(o, lang)}` : '';
  };
  const statusBadgeHtml = { CORRECT: '<span class="badge badge-green">✅ Correct</span>', WRONG: '<span class="badge badge-red">❌ Wrong</span>', SKIPPED: '<span class="badge badge-grey">⚪ Skipped</span>' }[q.status];

  $('#solCard').innerHTML = `
    <div class="sol-head">
      <span class="q-no">Q.${q.no}</span>
      <span class="badge badge-blue">${esc(sectionName(q.section, lang))}</span>
      ${q.topic ? `<span class="badge badge-grey">${esc(q.topic)}</span>` : ''}
      ${q.marked ? '<span class="badge badge-amber">Marked</span>' : ''}
      ${statusBadgeHtml}
    </div>
    <div class="q-text">${esc(txt(q.question, lang))}</div>
    <ul class="sol-options">${q.options.map((o) => {
      const isAns = o.key === q.answer;
      const isWrongPick = o.key === q.selected && !isAns;
      return `<li class="${isAns ? 'correct' : ''} ${isWrongPick ? 'wrong' : ''}">
        <b>${o.key})</b> ${esc(txt(o, lang))}
        ${isAns ? '<span class="tag" style="color:var(--success)">Correct answer</span>' : ''}
        ${isWrongPick ? '<span class="tag" style="color:var(--danger)">Your answer</span>' : ''}
        ${isAns && o.key === q.selected ? '<span class="tag" style="color:var(--success);margin-left:.5rem">Your answer</span>' : ''}
      </li>`;
    }).join('')}</ul>
    <div class="answer-lines">
      <div>Your answer: ${q.selected ? `<span class="${q.status === 'CORRECT' ? 'correct-text' : 'wrong-text'}">${esc(optText(q.selected))}</span>` : '<span class="muted">Not answered</span>'}</div>
      <div>Correct answer: <span class="correct-text">${esc(optText(q.answer))}</span></div>
      <div class="muted small">Time spent: ${humanDuration(q.timeSeconds)}</div>
    </div>
    <div class="explanation">
      <h4>Solution (Why ${esc(q.answer)} is correct)</h4>
      ${esc(txt(q.explanation, lang))}
    </div>
    <div class="sol-nav">
      <button class="btn" data-act="prev" ${solView.pos === 0 ? 'disabled' : ''}>◀ Previous</button>
      ${STATIC_MODE ? '' : `<button class="btn btn-sm btn-ghost" data-act="report" data-qid="${esc(q.id)}">⚑ Report an error</button>`}
      <button class="btn" data-act="next" ${solView.pos >= list.length - 1 ? 'disabled' : ''}>Next ▶</button>
    </div>`;
}

function reportQuestion(questionId) {
  const m = modal(`
    <h2>Report an error</h2>
    <p class="muted small">Question ${esc(questionId)} — tell us what is wrong (answer key, typo, translation…).</p>
    <form class="form" id="reportForm" novalidate>
      <textarea name="message" rows="4" maxlength="1000" required></textarea>
      <div class="form-error"></div>
      <div class="btn-row" style="justify-content:flex-end">
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Send report</button>
      </div>
    </form>`);
  $('[data-act=cancel]', m.el).onclick = m.close;
  bindForm($('#reportForm', m.el), async (d) => {
    await api(`/questions/${encodeURIComponent(questionId)}/report`, {
      method: 'POST', body: { message: d.message || '', attemptId: solView?.d.id },
    });
    m.close();
    toast('Thanks! The report was sent to the admin.', 'success');
  });
}
