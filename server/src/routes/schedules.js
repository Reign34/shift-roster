import { Router } from 'express';
import { db, transaction } from '../db.js';
import { requireAuth, requireManager } from '../middleware.js';
import { generateRoster } from '../generator.js';

export const scheduleRoutes = Router();
scheduleRoutes.use(requireAuth);

function eachDate(start, end) {
  const dates = [];
  const cursor = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

scheduleRoutes.get('/', (req, res) => {
  const schedules = db.prepare(`
    SELECT s.*, u.name AS created_by_name,
           (SELECT COUNT(*) FROM shifts WHERE schedule_id = s.id) AS shift_count
    FROM schedules s
    JOIN users u ON u.id = s.created_by
    ORDER BY s.start_date DESC
  `).all();
  res.json({ schedules });
});

// Creating a schedule also creates every slot in it: one per day per shift
// type. Doing it up front means the rest of the app only ever fills slots
// that already exist.
scheduleRoutes.post('/', requireManager, (req, res) => {
  const { name, start_date, end_date, required_staff } = req.body || {};

  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: 'Name, start date and end date are required' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'End date cannot be before the start date' });
  }

  const dates = eachDate(start_date, end_date);
  if (dates.length > 62) {
    return res.status(400).json({ error: 'Keep a schedule to two months or less' });
  }

  const staffPerShift = Number(required_staff) > 0 ? Number(required_staff) : 7;
  const types = db.prepare('SELECT id FROM shift_types ORDER BY id').all();

  // One transaction: a schedule with only half its shifts would be worse
  // than no schedule at all.
  const create = transaction(() => {
    const result = db.prepare(`
      INSERT INTO schedules (name, start_date, end_date, created_by) VALUES (?, ?, ?, ?)
    `).run(name.trim(), start_date, end_date, req.user.id);

    const scheduleId = result.lastInsertRowid;
    const insertShift = db.prepare(`
      INSERT INTO shifts (schedule_id, date, shift_type_id, required_staff) VALUES (?, ?, ?, ?)
    `);

    for (const date of dates) {
      for (const type of types) insertShift.run(scheduleId, date, type.id, staffPerShift);
    }
    return scheduleId;
  });

  const id = create();
  res.status(201).json({ id, shifts: dates.length * types.length });
});

// The whole roster in one response. The frontend needs shifts and the people
// on them together, and fetching assignments per shift would be 63 requests.
scheduleRoutes.get('/:id', (req, res) => {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'No such schedule' });

  const shifts = db.prepare(`
    SELECT sh.id, sh.date, sh.required_staff,
           st.name AS shift_name, st.start_time, st.end_time
    FROM shifts sh
    JOIN shift_types st ON st.id = sh.shift_type_id
    WHERE sh.schedule_id = ?
    ORDER BY sh.date, st.id
  `).all(req.params.id);

  const assignments = db.prepare(`
    SELECT a.id, a.shift_id, a.user_id, u.name
    FROM assignments a
    JOIN users u ON u.id = a.user_id
    JOIN shifts sh ON sh.id = a.shift_id
    WHERE sh.schedule_id = ?
  `).all(req.params.id);

  const byShift = new Map(shifts.map((s) => [s.id, { ...s, people: [] }]));
  for (const a of assignments) {
    byShift.get(a.shift_id)?.people.push({ assignment_id: a.id, id: a.user_id, name: a.name });
  }

  res.json({ schedule, shifts: [...byShift.values()] });
});

scheduleRoutes.post('/:id/generate', requireManager, (req, res) => {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'No such schedule' });

  const shifts = db.prepare(`
    SELECT sh.id, sh.date, sh.required_staff, sh.shift_type_id, st.name AS shift_name
    FROM shifts sh
    JOIN shift_types st ON st.id = sh.shift_type_id
    WHERE sh.schedule_id = ?
  `).all(req.params.id);

  const staff = db.prepare("SELECT id, name FROM users WHERE role IN ('staff','manager')").all();

  // Pulled once into sets so the generator never touches the database
  const rows = db.prepare(`
    SELECT user_id, date, status FROM availability
    WHERE date BETWEEN ? AND ?
  `).all(schedule.start_date, schedule.end_date);

  const unavailable = new Set();
  const preferred = new Set();
  for (const r of rows) {
    const key = `${r.user_id}|${r.date}`;
    if (r.status === 'unavailable') unavailable.add(key);
    else preferred.add(key);
  }

  const result = generateRoster({ shifts, staff, unavailable, preferred });

  const apply = transaction(() => {
    db.prepare(`
      DELETE FROM assignments WHERE shift_id IN (SELECT id FROM shifts WHERE schedule_id = ?)
    `).run(req.params.id);

    const insert = db.prepare('INSERT INTO assignments (shift_id, user_id) VALUES (?, ?)');
    for (const a of result.assignments) insert.run(a.shift_id, a.user_id);
  });
  apply();

  res.json({
    assigned: result.assignments.length,
    gaps: result.gaps,
    fairness: result.fairness
  });
});

scheduleRoutes.post('/:id/publish', requireManager, (req, res) => {
  const result = db.prepare("UPDATE schedules SET status = 'published' WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'No such schedule' });
  res.json({ status: 'published' });
});

scheduleRoutes.delete('/:id', requireManager, (req, res) => {
  const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'No such schedule' });
  res.json({ deleted: Number(req.params.id) });
});

// Manual assignment, for the cases the generator can't know about
scheduleRoutes.post('/shifts/:shiftId/assign', requireManager, (req, res) => {
  const { user_id } = req.body || {};
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.shiftId);
  if (!shift) return res.status(404).json({ error: 'No such shift' });

  const clash = db.prepare(`
    SELECT 1 FROM assignments a
    JOIN shifts s ON s.id = a.shift_id
    WHERE a.user_id = ? AND s.date = ? AND s.id != ?
  `).get(user_id, shift.date, shift.id);

  if (clash) return res.status(409).json({ error: 'Already working another shift that day' });

  try {
    const result = db.prepare('INSERT INTO assignments (shift_id, user_id) VALUES (?, ?)')
      .run(shift.id, user_id);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Already on this shift' });
    }
    throw err;
  }
});

scheduleRoutes.delete('/assignments/:id', requireManager, (req, res) => {
  const result = db.prepare('DELETE FROM assignments WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'No such assignment' });
  res.json({ deleted: Number(req.params.id) });
});
