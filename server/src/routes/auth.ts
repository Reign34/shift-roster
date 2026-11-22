import { Router } from 'express';
import { db, queryOne } from '../db.ts';
import { hashPassword, verifyPassword, signToken } from '../auth.ts';
import { requireAuth, currentUser } from '../middleware.ts';
import type { User, UserRow } from '../types.ts';

export const authRoutes: Router = Router();

function publicUser(row: User): User {
  // Never let password_hash leave this file
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

authRoutes.post('/register', (req, res) => {
  const { name, email, password } = req.body ?? {};

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email and password are all required' });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  // The first account to exist becomes the manager; everyone after is staff.
  // The `role` field in the body is read and deliberately ignored: letting a
  // client pick its own role is one of the easiest holes to leave open.
  const count = queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM users');
  const assignedRole = count && count.n === 0 ? 'manager' : 'staff';

  try {
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(
        String(name).trim(),
        String(email).trim().toLowerCase(),
        hashPassword(String(password)),
        assignedRole
      );

    const user = queryOne<User>(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      Number(result.lastInsertRowid)
    );

    if (!user) throw new Error('User vanished immediately after insert');

    res.status(201).json({ user: publicUser(user), token: signToken(user) });
  } catch (err) {
    if (String((err as Error).message).includes('UNIQUE')) {
      res.status(409).json({ error: 'That email is already registered' });
      return;
    }
    throw err;
  }
});

authRoutes.post('/login', (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = queryOne<UserRow>(
    'SELECT * FROM users WHERE email = ?',
    String(email).trim().toLowerCase()
  );

  // Same message and same work either way. Saying "no such account" tells an
  // attacker which emails are registered, and returning early for a missing
  // user makes it measurable even if the message is identical.
  const ok = user
    ? verifyPassword(String(password), user.password_hash)
    : verifyPassword(String(password), 'x:00');

  if (!user || !ok) {
    res.status(401).json({ error: 'Email or password is incorrect' });
    return;
  }

  res.json({ user: publicUser(user), token: signToken(user) });
});

// Lets the frontend ask "is this stored token still good, and who am I?"
authRoutes.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});
