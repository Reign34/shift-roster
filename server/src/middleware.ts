import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth.ts';
import { queryOne } from './db.ts';
import type { User } from './types.ts';

// Express's Request has no idea about our user, so we widen it once here.
// Every route handler then gets req.user typed, instead of casting in each.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// After requireAuth has run, req.user is guaranteed, but the type can't know
// that. Rather than scattering `req.user!` (which quietly assumes it) this
// throws loudly if a route was ever mounted without requireAuth in front.
export function currentUser(req: Request): User {
  if (!req.user) throw new Error('Route is missing requireAuth');
  return req.user;
}

// Reads the "Authorization: Bearer <token>" header and hangs the user off the
// request, so route handlers never have to think about tokens.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired. Sign in again.' });
    return;
  }

  // The token says who they are, but the database says what they are now.
  // Reading the row means a role change or a deleted account takes effect
  // immediately, instead of whenever their week-old token runs out.
  const user = queryOne<User>(
    'SELECT id, name, email, role FROM users WHERE id = ?',
    payload.sub
  );

  if (!user) {
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }

  req.user = user;
  next();
}

export function requireManager(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'manager') {
    res.status(403).json({ error: 'Only managers can do that' });
    return;
  }
  next();
}

// 401 means "I do not know who you are", 403 means "I know, and no".
// Mixing them up makes a frontend impossible to write sensibly.
