import { Router } from 'express';
import { db, queryAll } from '../db.ts';
import { requireAuth, currentUser } from '../middleware.ts';
import type { AvailabilityStatus } from '../types.ts';

export const availabilityRoutes: Router = Router();
availabilityRoutes.use(requireAuth);

type AvailabilityRow = {
  id: number;
  user_id: number;
  date: string;
  status: AvailabilityStatus;
  note: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A runtime check that also narrows the type, so the value reaching the
// database is known to be one of the two allowed strings.
function isStatus(value: unknown): value is AvailabilityStatus {
  return value === 'unavailable' || value === 'preferred';
}

// Staff see their own; managers can look at anyone's, which is what makes
// the generator's output explainable ("why is Kofi not on Tuesday").
availabilityRoutes.get('/', (req, res) => {
  const me = currentUser(req);
  const requested = req.query.user_id ? Number(req.query.user_id) : me.id;

  if (requested !== me.id && me.role !== 'manager') {
    res.status(403).json({ error: 'You can only see your own availability' });
    return;
  }

  const entries = queryAll<AvailabilityRow>(
    'SELECT id, user_id, date, status, note FROM availability WHERE user_id = ? ORDER BY date',
    requested
  );

  res.json({ entries });
});

// One row per person per day, so setting the same day twice replaces it
// rather than piling up contradictory entries.
availabilityRoutes.put('/', (req, res) => {
  const me = currentUser(req);
  const { date, status, note } = req.body ?? {};

  if (!date || !ISO_DATE.test(String(date))) {
    res.status(400).json({ error: 'A date in YYYY-MM-DD form is required' });
    return;
  }
  if (!isStatus(status)) {
    res.status(400).json({ error: 'Status must be unavailable or preferred' });
    return;
  }

  db.prepare(`
    INSERT INTO availability (user_id, date, status, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status, note = excluded.note
  `).run(me.id, String(date), status, note ? String(note) : null);

  res.json({ date, status });
});

availabilityRoutes.delete('/:date', (req, res) => {
  const me = currentUser(req);
  const result = db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?')
    .run(me.id, req.params.date);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Nothing set for that day' });
    return;
  }

  res.json({ cleared: req.params.date });
});
