import { Router } from 'express';
import { db, transaction } from '../db.js';
import { requireAuth } from '../middleware.js';

export const swapRoutes = Router();
swapRoutes.use(requireAuth);

// pending -> accepted | declined | cancelled, and nothing moves out of those.
// Keeping the allowed moves in one place stops the rules being re-implemented
// slightly differently in each handler.
const CAN_BECOME = {
  pending: ['accepted', 'declined', 'cancelled'],
  accepted: [],
  declined: [],
  cancelled: []
};

swapRoutes.get('/', (req, res) => {
  const isManager = req.user.role === 'manager';

  const swaps = db.prepare(`
    SELECT sw.*,
           req.name AS requester_name,
           tgt.name AS target_name,
           s.date, st.name AS shift_name
    FROM swap_requests sw
    JOIN users req ON req.id = sw.requester_id
    LEFT JOIN users tgt ON tgt.id = sw.target_user_id
    JOIN assignments a ON a.id = sw.assignment_id
    JOIN shifts s ON s.id = a.shift_id
    JOIN shift_types st ON st.id = s.shift_type_id
    WHERE ? = 1 OR sw.requester_id = ? OR sw.target_user_id = ?
    ORDER BY sw.created_at DESC
  `).all(isManager ? 1 : 0, req.user.id, req.user.id);

  res.json({ swaps });
});

swapRoutes.post('/', (req, res) => {
  const { assignment_id, target_user_id } = req.body || {};

  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignment_id);
  if (!assignment) return res.status(404).json({ error: 'No such assignment' });

  // You can only give away a shift that is actually yours
  if (assignment.user_id !== req.user.id) {
    return res.status(403).json({ error: 'That shift is not yours to swap' });
  }

  const alreadyOpen = db.prepare(
    "SELECT 1 FROM swap_requests WHERE assignment_id = ? AND status = 'pending'"
  ).get(assignment_id);

  if (alreadyOpen) {
    return res.status(409).json({ error: 'There is already an open request for that shift' });
  }

  const result = db.prepare(`
    INSERT INTO swap_requests (assignment_id, requester_id, target_user_id) VALUES (?, ?, ?)
  `).run(assignment_id, req.user.id, target_user_id || null);

  res.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
});

// Accepting is the interesting one: it has to move the shift as well as
// close the request, and both must happen or neither.
swapRoutes.post('/:id/accept', (req, res) => {
  const swap = db.prepare('SELECT * FROM swap_requests WHERE id = ?').get(req.params.id);
  if (!swap) return res.status(404).json({ error: 'No such request' });

  if (!CAN_BECOME[swap.status].includes('accepted')) {
    return res.status(409).json({ error: `This request is already ${swap.status}` });
  }

  // Open requests can be picked up by anyone; targeted ones only by the
  // person they were sent to. Managers can always step in.
  const isTarget = swap.target_user_id === req.user.id;
  const isOpen = swap.target_user_id === null;
  if (!isTarget && !isOpen && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'This request was not sent to you' });
  }
  if (swap.requester_id === req.user.id) {
    return res.status(400).json({ error: 'You cannot take your own shift' });
  }

  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(swap.assignment_id);
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(assignment.shift_id);

  // Taking a shift you are already on is a real possibility, not a silly one:
  // shifts hold several people, so the roster can easily have both of you on
  // it. Checked first, because it needs a different message.
  const sameShift = db.prepare(
    'SELECT 1 FROM assignments WHERE shift_id = ? AND user_id = ?'
  ).get(shift.id, req.user.id);

  if (sameShift) {
    return res.status(409).json({ error: 'You are already on that shift' });
  }

  // Any other shift that day. The assignment being handed over is excluded,
  // since that is the one about to change hands.
  const clash = db.prepare(`
    SELECT 1 FROM assignments a
    JOIN shifts s ON s.id = a.shift_id
    WHERE a.user_id = ? AND s.date = ? AND a.id != ?
  `).get(req.user.id, shift.date, swap.assignment_id);

  if (clash) {
    return res.status(409).json({ error: 'You are already working another shift that day' });
  }

  const accept = transaction(() => {
    db.prepare('UPDATE assignments SET user_id = ? WHERE id = ?')
      .run(req.user.id, swap.assignment_id);
    db.prepare("UPDATE swap_requests SET status = 'accepted', target_user_id = ? WHERE id = ?")
      .run(req.user.id, swap.id);
  });
  accept();

  res.json({ status: 'accepted', shift_now_belongs_to: req.user.id });
});

swapRoutes.post('/:id/decline', (req, res) => {
  const swap = db.prepare('SELECT * FROM swap_requests WHERE id = ?').get(req.params.id);
  if (!swap) return res.status(404).json({ error: 'No such request' });

  if (!CAN_BECOME[swap.status].includes('declined')) {
    return res.status(409).json({ error: `This request is already ${swap.status}` });
  }
  if (swap.target_user_id !== req.user.id && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'This request was not sent to you' });
  }

  db.prepare("UPDATE swap_requests SET status = 'declined' WHERE id = ?").run(swap.id);
  res.json({ status: 'declined' });
});

swapRoutes.post('/:id/cancel', (req, res) => {
  const swap = db.prepare('SELECT * FROM swap_requests WHERE id = ?').get(req.params.id);
  if (!swap) return res.status(404).json({ error: 'No such request' });

  if (!CAN_BECOME[swap.status].includes('cancelled')) {
    return res.status(409).json({ error: `This request is already ${swap.status}` });
  }
  if (swap.requester_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the person who asked can cancel it' });
  }

  db.prepare("UPDATE swap_requests SET status = 'cancelled' WHERE id = ?").run(swap.id);
  res.json({ status: 'cancelled' });
});

// What a staff member needs to request a swap: their own upcoming shifts
swapRoutes.get('/my-shifts', (req, res) => {
  const shifts = db.prepare(`
    SELECT a.id AS assignment_id, s.date, st.name AS shift_name,
           st.start_time, st.end_time, sc.name AS schedule_name, sc.status
    FROM assignments a
    JOIN shifts s ON s.id = a.shift_id
    JOIN shift_types st ON st.id = s.shift_type_id
    JOIN schedules sc ON sc.id = s.schedule_id
    WHERE a.user_id = ?
    ORDER BY s.date, st.id
  `).all(req.user.id);

  res.json({ shifts });
});
