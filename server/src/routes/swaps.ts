import { Router } from 'express';
import { db, transaction, queryOne, queryAll } from '../db.ts';
import { requireAuth, currentUser } from '../middleware.ts';
import type { SwapStatus, ShiftName } from '../types.ts';

export const swapRoutes: Router = Router();
swapRoutes.use(requireAuth);

type SwapRow = {
  id: number;
  assignment_id: number;
  requester_id: number;
  target_user_id: number | null;
  status: SwapStatus;
  created_at: string;
};

// pending -> accepted | declined | cancelled, and nothing moves out of those.
// Typing it as a Record of SwapStatus means adding a new status to the union
// without handling it here is a compile error rather than a silent gap.
const CAN_BECOME: Record<SwapStatus, SwapStatus[]> = {
  pending: ['accepted', 'declined', 'cancelled'],
  accepted: [],
  declined: [],
  cancelled: []
};

swapRoutes.get('/my-shifts', (req, res) => {
  const me = currentUser(req);

  const shifts = queryAll<{
    assignment_id: number; date: string; shift_name: ShiftName;
    start_time: string; end_time: string; schedule_name: string; status: string;
  }>(`
    SELECT a.id AS assignment_id, s.date, st.name AS shift_name,
           st.start_time, st.end_time, sc.name AS schedule_name, sc.status
    FROM assignments a
    JOIN shifts s ON s.id = a.shift_id
    JOIN shift_types st ON st.id = s.shift_type_id
    JOIN schedules sc ON sc.id = s.schedule_id
    WHERE a.user_id = ?
    ORDER BY s.date, st.id
  `, me.id);

  res.json({ shifts });
});

swapRoutes.get('/', (req, res) => {
  const me = currentUser(req);
  const isManager = me.role === 'manager';

  const swaps = queryAll(`
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
  `, isManager ? 1 : 0, me.id, me.id);

  res.json({ swaps });
});

swapRoutes.post('/', (req, res) => {
  const me = currentUser(req);
  const { assignment_id, target_user_id } = req.body ?? {};

  const assignment = queryOne<{ id: number; user_id: number; shift_id: number }>(
    'SELECT * FROM assignments WHERE id = ?', assignment_id
  );

  if (!assignment) {
    res.status(404).json({ error: 'No such assignment' });
    return;
  }

  // You can only give away a shift that is actually yours
  if (assignment.user_id !== me.id) {
    res.status(403).json({ error: 'That shift is not yours to swap' });
    return;
  }

  const alreadyOpen = queryOne(
    "SELECT 1 FROM swap_requests WHERE assignment_id = ? AND status = 'pending'",
    assignment_id
  );

  if (alreadyOpen) {
    res.status(409).json({ error: 'There is already an open request for that shift' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO swap_requests (assignment_id, requester_id, target_user_id) VALUES (?, ?, ?)
  `).run(assignment_id, me.id, target_user_id ?? null);

  res.status(201).json({ id: Number(result.lastInsertRowid), status: 'pending' });
});

// Accepting is the interesting one: it has to move the shift as well as
// close the request, and both must happen or neither.
swapRoutes.post('/:id/accept', (req, res) => {
  const me = currentUser(req);
  const swap = queryOne<SwapRow>('SELECT * FROM swap_requests WHERE id = ?', req.params.id);

  if (!swap) {
    res.status(404).json({ error: 'No such request' });
    return;
  }
  if (!CAN_BECOME[swap.status].includes('accepted')) {
    res.status(409).json({ error: `This request is already ${swap.status}` });
    return;
  }

  // Open requests can be picked up by anyone; targeted ones only by the
  // person they were sent to. Managers can always step in.
  const isTarget = swap.target_user_id === me.id;
  const isOpen = swap.target_user_id === null;
  if (!isTarget && !isOpen && me.role !== 'manager') {
    res.status(403).json({ error: 'This request was not sent to you' });
    return;
  }
  if (swap.requester_id === me.id) {
    res.status(400).json({ error: 'You cannot take your own shift' });
    return;
  }

  const assignment = queryOne<{ shift_id: number }>(
    'SELECT * FROM assignments WHERE id = ?', swap.assignment_id
  );
  if (!assignment) {
    res.status(404).json({ error: 'That shift no longer exists' });
    return;
  }

  const shift = queryOne<{ id: number; date: string }>(
    'SELECT * FROM shifts WHERE id = ?', assignment.shift_id
  );
  if (!shift) {
    res.status(404).json({ error: 'That shift no longer exists' });
    return;
  }

  // Taking a shift you are already on is a real possibility, not a silly one:
  // shifts hold several people, so the roster can easily have both of you on
  // it. Checked first, because it needs a different message.
  const sameShift = queryOne(
    'SELECT 1 FROM assignments WHERE shift_id = ? AND user_id = ?', shift.id, me.id
  );
  if (sameShift) {
    res.status(409).json({ error: 'You are already on that shift' });
    return;
  }

  // Any other shift that day. The assignment being handed over is excluded,
  // since that is the one about to change hands.
  const clash = queryOne(`
    SELECT 1 FROM assignments a
    JOIN shifts s ON s.id = a.shift_id
    WHERE a.user_id = ? AND s.date = ? AND a.id != ?
  `, me.id, shift.date, swap.assignment_id);

  if (clash) {
    res.status(409).json({ error: 'You are already working another shift that day' });
    return;
  }

  const accept = transaction((): void => {
    db.prepare('UPDATE assignments SET user_id = ? WHERE id = ?').run(me.id, swap.assignment_id);
    db.prepare("UPDATE swap_requests SET status = 'accepted', target_user_id = ? WHERE id = ?")
      .run(me.id, swap.id);
  });
  accept();

  res.json({ status: 'accepted', shift_now_belongs_to: me.id });
});

swapRoutes.post('/:id/decline', (req, res) => {
  const me = currentUser(req);
  const swap = queryOne<SwapRow>('SELECT * FROM swap_requests WHERE id = ?', req.params.id);

  if (!swap) {
    res.status(404).json({ error: 'No such request' });
    return;
  }
  if (!CAN_BECOME[swap.status].includes('declined')) {
    res.status(409).json({ error: `This request is already ${swap.status}` });
    return;
  }
  if (swap.target_user_id !== me.id && me.role !== 'manager') {
    res.status(403).json({ error: 'This request was not sent to you' });
    return;
  }

  db.prepare("UPDATE swap_requests SET status = 'declined' WHERE id = ?").run(swap.id);
  res.json({ status: 'declined' });
});

swapRoutes.post('/:id/cancel', (req, res) => {
  const me = currentUser(req);
  const swap = queryOne<SwapRow>('SELECT * FROM swap_requests WHERE id = ?', req.params.id);

  if (!swap) {
    res.status(404).json({ error: 'No such request' });
    return;
  }
  if (!CAN_BECOME[swap.status].includes('cancelled')) {
    res.status(409).json({ error: `This request is already ${swap.status}` });
    return;
  }
  if (swap.requester_id !== me.id) {
    res.status(403).json({ error: 'Only the person who asked can cancel it' });
    return;
  }

  db.prepare("UPDATE swap_requests SET status = 'cancelled' WHERE id = ?").run(swap.id);
  res.json({ status: 'cancelled' });
});
