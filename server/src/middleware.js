import { verifyToken } from './auth.js';
import { db } from './db.js';

// Reads the "Authorization: Bearer <token>" header and hangs the user off the
// request, so route handlers never have to think about tokens.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired. Sign in again.' });

  // The token says who they are, but the database says what they are now.
  // Reading the row means a role change or a deleted account takes effect
  // immediately, instead of whenever their week-old token runs out.
  const user = db
    .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .get(payload.sub);

  if (!user) return res.status(401).json({ error: 'Account no longer exists' });

  req.user = user;
  next();
}

export function requireManager(req, res, next) {
  if (req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Only managers can do that' });
  }
  next();
}

// 401 means "I do not know who you are", 403 means "I know, and no".
// Mixing them up makes a frontend impossible to write sensibly.
