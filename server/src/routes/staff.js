import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireManager } from '../middleware.js';
import { hashPassword } from '../auth.js';

export const staffRoutes = Router();

// Everything below needs a signed-in user
staffRoutes.use(requireAuth);

// Staff can see the team list; it's needed to read a roster
staffRoutes.get('/', (req, res) => {
  const staff = db
    .prepare('SELECT id, name, email, role, created_at FROM users ORDER BY name')
    .all();
  res.json({ staff });
});

staffRoutes.post('/', requireManager, (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are all required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (role && role !== 'staff' && role !== 'manager') {
    return res.status(400).json({ error: 'Role must be staff or manager' });
  }

  try {
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), hashPassword(password), role || 'staff');

    const user = db
      .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json({ user });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That email is already registered' });
    }
    throw err;
  }
});

staffRoutes.delete('/:id', requireManager, (req, res) => {
  const id = Number(req.params.id);

  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove your own account' });
  }

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'No such person' });

  res.json({ deleted: id });
});
