# JTET Mock Portal — Level 2 (Class 6 to 8)

An online mock-test portal for **Jharkhand Teacher Eligibility Test (JTET) Paper II / Level 2** (Upper Primary, Class 6–8).
Candidates log in, attempt a **Full Mock** (2 hrs 30 mins) or **Sectional Mocks**, and only **after submitting** can they review every question with the correct answer and a step-by-step solution explaining *why* it is correct.

---

## Table of Contents

1. [Exam Pattern Covered](#1-exam-pattern-covered)
2. [Core Features](#2-core-features)
3. [User Flow](#3-user-flow)
4. [Module Details](#4-module-details)
   - 4.1 Login & Registration
   - 4.2 Dashboard
   - 4.3 Section A — Full Mock
   - 4.4 Section B — Sectional Mock
   - 4.5 Exam Screen (CBT Interface)
   - 4.6 Result Screen
   - 4.7 Solution / Answer Review (Locked until submission)
5. [Business Rules](#5-business-rules)
6. [Tech Stack](#6-tech-stack)
7. [Project Structure](#7-project-structure)
8. [Data Model](#8-data-model)
9. [API Endpoints](#9-api-endpoints)
10. [Question Bank Format](#10-question-bank-format)
11. [Local Setup](#11-local-setup)
12. [Security Notes](#12-security-notes)
13. [Roadmap](#13-roadmap)

---

## 1. Exam Pattern Covered

Based on the JTET Level 2 subject combination: **CDP + Mathematics & Science + Computer + Language-1 (English / Hindi) + Language-2 (Khortha)**.

| # | Section | Questions | Marks |
|---|---------|:---------:|:-----:|
| 1 | Child Development & Pedagogy (CDP) | 30 | 30 |
| 2 | Mathematics & Science | 50 | 50 |
| 3 | Computer | 10 | 10 |
| 4 | Language-1 (English **or** Hindi) | 30 | 30 |
| 5 | Language-2 (Khortha) | 30 | 30 |
| | **Total** | **150** | **150** |

- **Duration:** 2 hours 30 minutes (150 minutes)
- **Question type:** Multiple Choice (4 options, single correct)
- **Marking:** +1 per correct answer, **no negative marking**
- **Medium:** Bilingual display (English / Hindi toggle) for non-language sections

> ⚠️ Section-wise counts are kept in a config file (`config/exam-pattern.json`) so they can be updated if JAC revises the pattern — no code change needed.

---

## 2. Core Features

| Feature | Description |
|---------|-------------|
| 🔐 Login required | No mock can be opened without an authenticated session |
| 📝 Full Mock | 150 questions, 150 minutes, all 5 sections, single timer |
| 🎯 Sectional Mock | Practice one section at a time with its own timer |
| ⏱️ Live timer + auto-submit | Exam auto-submits when time runs out |
| 🧭 Question palette | Answered / Not answered / Marked for review / Not visited |
| 💾 Auto-save | Every answer saved to server instantly (survives refresh / network drop) |
| 📊 Result analytics | Score, section-wise score, accuracy, time spent per question |
| 🔒 Locked solutions | Answers & explanations visible **only after** the attempt is submitted |
| 📖 Solution review | Question → Your answer → Correct answer → *Why* explanation |
| 🕘 Attempt history | All past attempts with scores and links to their solutions |

---

## 3. User Flow

```
┌──────────────┐
│  Login Page  │──(new user)──► Register ──► Login
└──────┬───────┘
       │ authenticated
       ▼
┌──────────────────────────────────────────┐
│               DASHBOARD                  │
│  ┌────────────────┐  ┌────────────────┐  │
│  │ A. FULL MOCK   │  │ B. SECTIONAL   │  │
│  │ 150 Q · 150 min│  │ MOCK           │  │
│  └───────┬────────┘  └───────┬────────┘  │
│          │                   │           │
│   Attempt History / Past Results         │
└──────────┼───────────────────┼───────────┘
           ▼                   ▼
   Select Mock Test     Select Section ──► Select Test
           │                   │
           └─────────┬─────────┘
                     ▼
            Instructions Page
      (rules, timer, palette legend,
       "I have read" checkbox → Start)
                     ▼
              EXAM SCREEN (CBT)
                     │
        Submit  ─or─  Timer ends (auto-submit)
                     ▼
               RESULT SCREEN
                     │
                     ▼
     SOLUTION REVIEW (unlocked only now)
     Question → Your Answer → Correct Answer → Explanation
```

---

## 4. Module Details

### 4.1 Login & Registration
- Fields: **Name, Mobile / Email, Password** (optional: Roll No. for reference).
- Login via email/mobile + password. JWT-based session (HTTP-only cookie).
- "Forgot password" via email OTP / reset link.
- Every route except `/login`, `/register`, `/forgot-password` is protected.

### 4.2 Dashboard
- Greeting + quick stats (tests attempted, best score, average score).
- Two big cards: **A. Full Mock** and **B. Sectional Mock**.
- **Attempt History** table: Test name · Date · Score · Time taken · `View Result` · `View Solutions`.

### 4.3 Section A — Full Mock (2 hrs 30 mins)
- List of full-length tests (Mock 1, Mock 2, …) with status: *Not Attempted / In Progress / Completed*.
- Each test = 150 questions in fixed section order: CDP → Maths & Science → Computer → Language-1 → Language-2.
- Before start: candidate selects **Language-1 choice (English or Hindi)**. Language-2 is fixed to **Khortha**.
- One global timer of **150:00 minutes**. Candidate can jump freely between sections (same as the real exam).
- An *In Progress* test can be resumed with remaining time (timer is server-side, see §5).

### 4.4 Section B — Sectional Mock (Practice)
- Candidate first picks a section, then a test inside it:

| Section | Questions per test | Time per test |
|---------|:------------------:|:-------------:|
| Child Development & Pedagogy | 30 | 30 min |
| Mathematics & Science | 50 | 50 min |
| Computer | 10 | 10 min |
| Language-1 (English / Hindi) | 30 | 30 min |
| Language-2 (Khortha) | 30 | 30 min |

  *(Time = 1 min per question, same pace as the full exam; configurable.)*
- Optional topic filter inside a section (e.g. Maths → Fractions, Science → Light).
- Same exam screen, same submit → result → solution flow as the Full Mock.

### 4.5 Exam Screen (CBT Interface)
Layout modelled on standard computer-based tests:

```
┌───────────────────────────────────────────────────────────────┐
│ JTET Level 2 – Full Mock 1        Candidate: Ritwik   ⏱ 01:42:15│
├───────────────────────────────────────────────────────────────┤
│ [CDP] [Maths & Sci] [Computer] [Lang-1] [Lang-2]   EN | हिं    │
├─────────────────────────────────────────────┬─────────────────┤
│ Q.12  (CDP)                                 │  Question       │
│ Question text …                             │  Palette        │
│  ○ A) …                                     │  1  2  3  4  5  │
│  ○ B) …                                     │  6  7  8  9 10  │
│  ○ C) …                                     │ …               │
│  ○ D) …                                     │ ■ Answered      │
│                                             │ ■ Not answered  │
│                                             │ ■ Marked review │
│                                             │ □ Not visited   │
├─────────────────────────────────────────────┴─────────────────┤
│ [Mark for Review & Next] [Clear Response]  [Save & Next] [Submit]│
└───────────────────────────────────────────────────────────────┘
```

- Timer turns red in the last 5 minutes; warning toast at 10 and 5 minutes.
- **Submit** shows a confirmation summary: answered / not answered / marked for review per section.
- **No answer, no "correct" indicator, and no explanation is ever shown on this screen.**
- Copy, right-click and text selection disabled (soft deterrent).

### 4.6 Result Screen
Shown immediately after submission:
- Total score `/150` (or `/section total` for sectional), percentage, rank among attempts (optional).
- Section-wise table: Attempted · Correct · Wrong · Skipped · Score · Accuracy %.
- Time spent overall and per section; slowest questions highlighted.
- Qualifying indicator (configurable cut-off, e.g. 60% General / 55% reserved categories — keep editable in config).
- Button: **View Solutions →**

### 4.7 Solution / Answer Review (Locked until submission)
Unlocked **only** for an attempt whose status is `SUBMITTED`. Each question is shown as:

```
Q.27  [Mathematics & Science]                      ✅ Correct / ❌ Wrong / ⚪ Skipped
──────────────────────────────────────────────────────────────
Question:      What is the LCM of 12 and 18?
Options:       A) 24   B) 36   C) 54   D) 72
Your answer:   A) 24            ← highlighted red
Correct answer: B) 36           ← highlighted green

Solution (Why B is correct):
12 = 2² × 3,  18 = 2 × 3²
LCM = highest power of each prime = 2² × 3² = 36.
Option A (24) is not divisible by 18, so it cannot be a common multiple.
──────────────────────────────────────────────────────────────
[◀ Previous]                                         [Next ▶]
```

- Filters: **All · Correct · Wrong · Skipped · Marked for review**, and by section.
- Explanation supports text, formulas (KaTeX) and images (diagrams for Science).
- "Report an error in this question" button for the admin to fix the question bank.

---

## 5. Business Rules

| ID | Rule |
|----|------|
| BR-01 | User must be logged in to view the dashboard or start any mock. |
| BR-02 | Correct answers and explanations are **never sent to the browser** while an attempt is `IN_PROGRESS`. |
| BR-03 | Solutions for an attempt are unlocked only when `attempt.status = SUBMITTED` (manual submit or auto-submit). |
| BR-04 | Solution access is per attempt and per user — a user cannot open another user's attempt. |
| BR-05 | Timer is server-authoritative: `end_time = start_time + duration`. The client timer is only for display. Answers saved after `end_time` are rejected. |
| BR-06 | If the browser closes, the attempt continues on the server clock; on return the user resumes with the remaining time, or sees an auto-submitted result if time is over. |
| BR-07 | A background job auto-submits any attempt whose `end_time` has passed. |
| BR-08 | Re-attempts are allowed; each creates a new attempt. Earlier attempts' solutions stay accessible in history. |
| BR-09 | No negative marking: score = number of correct answers. |
| BR-10 | Sectional mock time = 1 minute × number of questions (configurable). |

---

## 6. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **Next.js (React) + TypeScript + Tailwind CSS** | Fast UI, SSR for protected pages |
| Backend | **Node.js + Express** (or Next.js API routes) | Simple REST APIs |
| Database | **PostgreSQL** + Prisma ORM | Relational data (users, tests, attempts) |
| Auth | JWT in HTTP-only cookie + bcrypt password hashing | Secure sessions |
| Math rendering | KaTeX | Formulas in Maths/Science solutions |
| Jobs | node-cron | Auto-submit expired attempts |
| Hosting | Vercel (frontend) + Render/Railway (API + DB) | Low-cost deployment |

> A lighter alternative for an MVP: Next.js full-stack + SQLite + Prisma, deploy on a single server.

---

## 7. Project Structure

```
jtet-mock-portal/
├── README.md
├── config/
│   └── exam-pattern.json         # sections, question counts, durations, cut-offs
├── data/
│   └── questions/                # question bank JSON files (see §10)
│       ├── cdp.json
│       ├── maths-science.json
│       ├── computer.json
│       ├── english.json
│       ├── hindi.json
│       └── khortha.json
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                   # loads question bank + creates mock tests
├── src/
│   ├── app/                      # Next.js pages
│   │   ├── login/
│   │   ├── register/
│   │   ├── dashboard/
│   │   ├── full-mock/
│   │   ├── sectional-mock/
│   │   ├── exam/[attemptId]/          # CBT screen
│   │   ├── result/[attemptId]/
│   │   └── solutions/[attemptId]/     # locked until submitted
│   ├── components/               # Timer, QuestionPalette, OptionList, SolutionCard…
│   ├── server/
│   │   ├── routes/               # auth, tests, attempts, solutions
│   │   ├── middleware/auth.ts
│   │   ├── services/scoring.ts
│   │   └── jobs/autoSubmit.ts
│   └── lib/
└── .env.example
```

---

## 8. Data Model

```
User
 ├─ id, name, email, mobile, password_hash, created_at

Section
 ├─ id, code (CDP | MATH_SCI | COMPUTER | LANG1_EN | LANG1_HI | LANG2_KHORTHA), name

Question
 ├─ id, section_id, topic, difficulty
 ├─ question_text_en, question_text_hi
 ├─ options (JSON: [{key:"A", text_en, text_hi}, …])
 ├─ correct_option            ← server-only
 └─ explanation_en, explanation_hi   ← server-only

MockTest
 ├─ id, title, type (FULL | SECTIONAL), section_id (null for FULL)
 ├─ duration_minutes, total_questions, is_published

MockTestQuestion
 ├─ mock_test_id, question_id, order_no

Attempt
 ├─ id, user_id, mock_test_id, language1_choice (EN | HI)
 ├─ status (IN_PROGRESS | SUBMITTED)
 ├─ start_time, end_time, submitted_at, submit_type (MANUAL | AUTO)
 └─ score, correct_count, wrong_count, skipped_count

AttemptAnswer
 ├─ attempt_id, question_id, selected_option (nullable)
 ├─ is_marked_for_review, time_spent_seconds
 └─ is_correct (filled at submission)
```

---

## 9. API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| POST | `/api/auth/register` | Create account | – |
| POST | `/api/auth/login` | Login, sets session cookie | – |
| POST | `/api/auth/logout` | Logout | ✔ |
| GET | `/api/tests?type=FULL` | List full mocks | ✔ |
| GET | `/api/tests?type=SECTIONAL&section=CDP` | List sectional mocks | ✔ |
| POST | `/api/attempts` | Start attempt `{ mockTestId, language1Choice }` | ✔ |
| GET | `/api/attempts/:id` | Questions + saved answers + remaining time (**no answers/solutions**) | ✔ |
| PUT | `/api/attempts/:id/answers` | Save/update one answer `{ questionId, selectedOption, markedForReview }` | ✔ |
| POST | `/api/attempts/:id/submit` | Submit and score the attempt | ✔ |
| GET | `/api/attempts/:id/result` | Score + section-wise analytics | ✔ (submitted only) |
| GET | `/api/attempts/:id/solutions` | Questions + user answer + correct answer + explanation | ✔ (submitted only, else `403`) |
| GET | `/api/me/attempts` | Attempt history | ✔ |

---

## 10. Question Bank Format

Each file in `data/questions/` is an array of questions:

```json
[
  {
    "id": "MS-0001",
    "section": "MATH_SCI",
    "topic": "LCM & HCF",
    "difficulty": "easy",
    "question": {
      "en": "What is the LCM of 12 and 18?",
      "hi": "12 और 18 का लघुत्तम समापवर्त्य (LCM) क्या है?"
    },
    "options": [
      { "key": "A", "en": "24", "hi": "24" },
      { "key": "B", "en": "36", "hi": "36" },
      { "key": "C", "en": "54", "hi": "54" },
      { "key": "D", "en": "72", "hi": "72" }
    ],
    "answer": "B",
    "explanation": {
      "en": "12 = 2² × 3 and 18 = 2 × 3². LCM takes the highest power of each prime: 2² × 3² = 36. 24 is not divisible by 18, so A is wrong.",
      "hi": "12 = 2² × 3 तथा 18 = 2 × 3²। LCM में प्रत्येक अभाज्य की सबसे बड़ी घात ली जाती है: 2² × 3² = 36।"
    }
  }
]
```

**Suggested topic coverage**

| Section | Key topics |
|---------|-----------|
| CDP | Growth & development, Piaget / Vygotsky / Kohlberg, inclusive education, learning & motivation, assessment (CCE), NEP 2020, RTE Act |
| Maths & Science | Number system, algebra, geometry, mensuration, data handling, maths pedagogy; matter, living world, motion, light, electricity, natural resources, science pedagogy |
| Computer | Computer basics, hardware/software, OS, MS Office, internet & email, cyber safety, ICT in education |
| Language-1 (English / Hindi) | Unseen passage, grammar, vocabulary, language pedagogy |
| Language-2 (Khortha) | Unseen passage, grammar, Khortha literature basics, language pedagogy |

Minimum bank size for launch: **3 full mocks** (450 Q) + **5 sectional tests per section**.

---

## 11. Local Setup

The current build uses the lightweight stack: **Node.js + Express + SQLite** (Node's built-in `node:sqlite`, so there is no database server to install) with a no-build HTML/JS frontend in `public/`. It needs **Node.js 22.13 or newer**.

```bash
# 1. Install
npm install

# 2. Environment (optional for local use)
cp .env.example .env      # set JWT_SECRET to a long random string

# 3. Run
npm start                 # http://localhost:3000
npm run dev               # same, restarts on file changes
```

- On first start the database (`data/jtet.db`) is created and the question bank is loaded automatically.
- After editing `data/questions/*.json` or `config/exam-pattern.json`, run `npm run seed` to reload questions and rebuild the tests (past attempts are kept).
- Tests are built from the bank in chunks of the section sizes in `config/exam-pattern.json`. While the bank is smaller than one full set, a single partial Full Mock and one practice test per section are created.
- To start over, stop the server and delete `data/jtet.db*`.

| Path | Purpose |
|------|---------|
| `server/index.js` | Express app, static files, error handling |
| `server/db.js` | SQLite schema |
| `server/seed.js` | Question bank loader + mock test builder |
| `server/routes/` | `auth`, `tests`, `attempts` (incl. result, solutions, history, error reports) |
| `server/services/scoring.js` | Server-side scoring and submission |
| `server/jobs/autoSubmit.js` | Auto-submits expired attempts every 30 s |
| `public/` | Frontend (login, dashboard, CBT exam screen, result, solutions) |

---

## 12. Security Notes

- **Answer keys stay on the server.** The exam API returns only `id`, question text and options. `correct_option` and `explanation` are selected only by the `/solutions` endpoint, which checks `status === SUBMITTED` and `attempt.user_id === session.user_id`.
- Scoring happens on the server at submission — the client never computes or sends a score.
- Server-side timer (`end_time`) prevents extending time by changing the device clock.
- Passwords hashed with bcrypt; rate-limit login and answer-save endpoints.
- Input validation (zod) on every request body.

---

## 13. Roadmap

- [ ] **MVP:** Login, Full Mock, Sectional Mock, result, locked solution review
- [ ] Admin panel: add/edit questions, bulk upload via Excel/CSV, publish tests
- [ ] Topic-wise weak-area report across attempts
- [ ] Bookmark questions for revision
- [ ] Previous Year Questions (PYQ) section
- [ ] Leaderboard per mock
- [ ] PWA / offline support for low-bandwidth areas
- [ ] Mobile OTP login

---

*Disclaimer: This is an independent practice portal and is not affiliated with the Jharkhand Academic Council (JAC). Verify the latest exam pattern on the official notification.*
