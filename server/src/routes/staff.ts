import { Router } from 'express';
import { db, queryAll } from '../db.ts';
import { requireAuth, requireManager, currentUser } from '../middleware.ts';
import { hashPassword } from '../auth.ts';
import type { User } from '../types.ts';

export const staffRoutes: Router = Router();

// Everything below needs a signed-in user
staffRoutes.use(requireAuth);

// Staff can see the team list; it's needed to read a roster
staffRoutes.get('/', (req, res) => {
  const staff = queryAll<User>(
    'SELECT id, name, email, role, created_at FROM users ORDER BY name'
  );
  res.json({ staff });
});

staffRoutes.post('/', requireManager, (req, res) => {
  const { name, email, password, role } = req.body ?? {};

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email and password are all required' });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  if (role && role !== 'staff' && role !== 'manager') {
    res.status(400).json({ error: 'Role must be staff or manager' });
    return;
  }

  try {
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(
        String(name).trim(),
        String(email).trim().toLowerCase(),
        hashPassword(String(password)),
        role ?? 'staff'
      );

    res.status(201).json({
      user: {
        id: Number(result.lastInsertRowid),
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        role: role ?? 'staff'
      }
    });
  } catch (err) {
    if (String((err as Error).message).includes('UNIQUE')) {
      res.status(409).json({ error: 'That email is already registered' });
      return;
    }
    throw err;
  }
});

staffRoutes.delete('/:id', requireManager, (req, res) => {
  const id = Number(req.params.id);
  const me = currentUser(req);

  if (id === me.id) {
    res.status(400).json({ error: 'You cannot remove your own account' });
    return;
  }

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'No such person' });
    return;
  }

  res.json({ deleted: id });
});
