import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function Schedules() {
  const { isManager } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [start, setStart] = useState(nextMonday());
  const [end, setEnd] = useState(addDays(nextMonday(), 6));
  const [perShift, setPerShift] = useState(7);

  async function load() {
    try {
      const { schedules } = await api.schedules();
      setSchedules(schedules);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  useEffect(() => { load(); }, []);

  async function create(event) {
    event.preventDefault();
    setError('');
    try {
      await api.createSchedule({
        name, start_date: start, end_date: end, required_staff: Number(perShift)
      });
      setShowForm(false);
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this schedule and everything assigned in it?')) return;
    try {
      await api.deleteSchedule(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (status === 'loading') return <p className="muted">Loading schedules...</p>;

  return (
    <div>
      <div className="row row--between">
        <h2 className="h2">Schedules</h2>
        {isManager && (
          <button className="btn btn--primary btn--sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'New schedule'}
          </button>
        )}
      </div>

      {error && <p className="alert">{error}</p>}

      {showForm && (
        <form className="card form-grid" onSubmit={create}>
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="Week of 24 Nov" required />
          </label>
          <label className="field">
            <span className="field__label">Starts</span>
            <input className="input" type="date" value={start}
                   onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field__label">Ends</span>
            <input className="input" type="date" value={end}
                   onChange={(e) => setEnd(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field__label">Staff per shift</span>
            <input className="input" type="number" min="1" max="30" value={perShift}
                   onChange={(e) => setPerShift(e.target.value)} required />
          </label>
          <button className="btn btn--primary">Create</button>
        </form>
      )}

      {schedules.length === 0 ? (
        <p className="muted">No schedules yet.</p>
      ) : (
        <ul className="list">
          {schedules.map((s) => (
            <li key={s.id} className="card row row--between">
              <div>
                <Link className="link-strong" to={`/schedules/${s.id}`}>{s.name}</Link>
                <p className="muted small">
                  {s.start_date} to {s.end_date} &middot; {s.shift_count} shifts &middot;{' '}
                  <span className={s.status === 'published' ? 'pill pill--good' : 'pill'}>{s.status}</span>
                </p>
              </div>
              {isManager && (
                <button className="btn btn--ghost btn--sm" onClick={() => remove(s.id)}>Delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
