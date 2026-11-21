import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signToken } from '../auth.js';
import { requireAuth } from '../middleware.js';

export const authRoutes = Router();

function publicUser(row) {
  // Never let password_hash leave this file
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

authRoutes.post('/register', (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are all required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // The first account to exist becomes the manager; everyone after is staff
  // unless a manager creates them. Without this there is no way to bootstrap.
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const assignedRole = isFirstUser ? 'manager' : (role === 'manager' ? 'staff' : 'staff');

  try {
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), hashPassword(password), assignedRole);

    const user = db
      .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json({ user: publicUser(user), token: signToken(user) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That email is already registered' });
    }
    throw err;
  }
});

authRoutes.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase());

  // Same message and same work either way. Saying "no such account" tells an
  // attacker which emails are registered, and returning early for a missing
  // user makes it measurable even if the message is identical.
  const ok = user
    ? verifyPassword(password, user.password_hash)
    : verifyPassword(password, 'x:00');

  if (!user || !ok) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }

  res.json({ user: publicUser(user), token: signToken(user) });
});

// Lets the frontend ask "is this stored token still good, and who am I?"
authRoutes.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
