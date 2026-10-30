// No login: every browser is identified by an anonymous candidate id kept in a signed,
// HTTP-only cookie. The first API call from a new browser creates the candidate.
const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('⚠  JWT_SECRET not set — using an insecure development secret. Set it in .env before deploying.');
}

const COOKIE = 'candidate';
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const GUEST_NAME = 'Candidate';

function setCandidateCookie(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: '365d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
  });
}

async function findCandidate(token) {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    return (await db.get('SELECT id, name FROM users WHERE id = ?', Number(sub))) || null;
  } catch {
    return null;
  }
}

// Small in-memory fixed-window rate limiter (enough for a single-server deployment).
function rateLimit({ windowMs, max, key = (req) => req.user?.id ?? req.ip }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const k = String(key(req));
    let h = hits.get(k);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(k, h);
    }
    if (++h.count > max) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    next();
  };
}

const newCandidateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, key: (req) => req.ip });

async function identifyCandidate(req, res, next) {
  const existing = await findCandidate(req.cookies[COOKIE]);
  if (existing) {
    req.user = existing;
    return next();
  }
  newCandidateLimiter(req, res, async () => {
    try {
      req.user = await db.get(
        "INSERT INTO users (name, password_hash, created_at) VALUES (?, '', ?) RETURNING id, name",
        GUEST_NAME, Date.now());
      setCandidateCookie(res, req.user.id);
      next();
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { identifyCandidate, rateLimit };
