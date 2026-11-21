import { useEffect, useState } from 'react';
import { api } from '../api';

function dayLabel(iso) {
  return new Date(iso + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export default function MyShifts() {
  const [shifts, setShifts] = useState([]);
  const [swaps, setSwaps] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    try {
      const [mine, open] = await Promise.all([api.myShifts(), api.swaps()]);
      setShifts(mine.shifts);
      setSwaps(open.swaps);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  useEffect(() => { load(); }, []);

  async function act(fn, assignmentOrId, message) {
    setError('');
    setNote('');
    try {
      await fn(assignmentOrId);
      setNote(message);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (status === 'loading') return <p className="muted">Loading your shifts...</p>;

  // A shift is "offered" if this person opened a request for it
  const offered = new Set(
    swaps.filter((s) => s.status === 'pending').map((s) => s.assignment_id)
  );

  const incoming = swaps.filter((s) => s.status === 'pending' && !offered.has(s.assignment_id));

  return (
    <div>
      <h2 className="h2">My shifts</h2>
      {error && <p className="alert">{error}</p>}
      {note && <p className="note">{note}</p>}

      {shifts.length === 0 ? (
        <p className="muted">Nothing assigned to you yet.</p>
      ) : (
        <ul className="list">
          {shifts.map((s) => (
            <li key={s.assignment_id} className="card row row--between">
              <div>
                <strong>{s.shift_name}</strong>
                <p className="muted small">
                  {dayLabel(s.date)} &middot; {s.start_time}&ndash;{s.end_time} &middot; {s.schedule_name}
                </p>
              </div>
              {offered.has(s.assignment_id) ? (
                <span className="pill">swap offered</span>
              ) : (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => act((id) => api.openSwap({ assignment_id: id }), s.assignment_id, 'Shift offered for swap.')}
                >
                  Offer swap
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="h2">Swap requests</h2>
      {swaps.length === 0 ? (
        <p className="muted">Nothing open.</p>
      ) : (
        <ul className="list">
          {swaps.map((s) => (
            <li key={s.id} className="card row row--between">
              <div>
                <strong>{s.shift_name} on {s.date}</strong>
                <p className="muted small">
                  offered by {s.requester_name}
                  {s.target_name ? ` to ${s.target_name}` : ' to anyone'}
                  {' '}&middot; <span className={'pill' + (s.status === 'accepted' ? ' pill--good' : '')}>{s.status}</span>
                </p>
              </div>
              {s.status === 'pending' && (
                <div className="row">
                  <button className="btn btn--primary btn--sm"
                          onClick={() => act(api.acceptSwap, s.id, 'Shift taken.')}>
                    Take it
                  </button>
                  <button className="btn btn--ghost btn--sm"
                          onClick={() => act(api.cancelSwap, s.id, 'Request cancelled.')}>
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
