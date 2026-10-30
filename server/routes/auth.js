const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, setSession, clearSession, rateLimit } = require('../middleware/auth');
const { httpError, optional } = require('../lib/http');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, key: (req) => req.ip });

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, mobile: u.mobile, rollNo: u.roll_no });

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: optional(z.string().trim().toLowerCase().email('Enter a valid email address').max(120)),
  mobile: optional(z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  rollNo: optional(z.string().trim().max(30)),
}).refine((d) => d.email || d.mobile, { message: 'Enter an email or a mobile number' });

router.post('/register', authLimiter, (req, res) => {
  const d = registerSchema.parse(req.body);
  const taken = db.prepare('SELECT 1 FROM users WHERE email = ? OR mobile = ?').get(d.email ?? null, d.mobile ?? null);
  if (taken) throw httpError(409, 'An account with this email or mobile already exists.');

  const hash = bcrypt.hashSync(d.password, 10);
  const { id } = db.prepare(`
    INSERT INTO users (name, email, mobile, roll_no, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(d.name, d.email ?? null, d.mobile ?? null, d.rollNo ?? null, hash, Date.now());

  setSession(res, id);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or mobile number'),
  password: z.string().min(1, 'Enter your password'),
});

router.post('/login', authLimiter, (req, res) => {
  const d = loginSchema.parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR mobile = ?').get(d.identifier.toLowerCase(), d.identifier);
  if (!user || !bcrypt.compareSync(d.password, user.password_hash)) {
    throw httpError(401, 'Incorrect email/mobile or password.');
  }
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
