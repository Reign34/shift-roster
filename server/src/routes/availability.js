import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';

export const availabilityRoutes = Router();
availabilityRoutes.use(requireAuth);

// Staff see their own; managers can look at anyone's, which is what makes
// the generator's output explainable ("why is Kofi not on Tuesday").
availabilityRoutes.get('/', (req, res) => {
  const requested = req.query.user_id ? Number(req.query.user_id) : req.user.id;

  if (requested !== req.user.id && req.user.role !== 'manager') {
    return res.status(403).json({ error: "You can only see your own availability" });
  }

  const entries = db.prepare(
    'SELECT id, user_id, date, status, note FROM availability WHERE user_id = ? ORDER BY date'
  ).all(requested);

  res.json({ entries });
});

// One row per person per day, so setting the same day twice replaces it
// rather than piling up contradictory entries.
availabilityRoutes.put('/', (req, res) => {
  const { date, status, note } = req.body || {};

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'A date in YYYY-MM-DD form is required' });
  }
  if (status !== 'unavailable' && status !== 'preferred') {
    return res.status(400).json({ error: 'Status must be unavailable or preferred' });
  }

  db.prepare(`
    INSERT INTO availability (user_id, date, status, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status, note = excluded.note
  `).run(req.user.id, date, status, note || null);

  res.json({ date, status });
});

availabilityRoutes.delete('/:date', (req, res) => {
  const result = db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?')
    .run(req.user.id, req.params.date);

  if (result.changes === 0) return res.status(404).json({ error: 'Nothing set for that day' });
  res.json({ cleared: req.params.date });
});
