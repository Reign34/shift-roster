import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

// Four weeks from today is enough to cover the schedules being built
const DAYS_AHEAD = 28;

function upcomingDates() {
  const out = [];
  const today = new Date();
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function Availability() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('loading');

  const dates = useMemo(upcomingDates, []);

  async function load() {
    try {
      const { entries } = await api.availability();
      setEntries(entries);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  useEffect(() => { load(); }, []);

  const byDate = useMemo(
    () => new Map(entries.map((e) => [e.date, e.status])),
    [entries]
  );

  // Clicking cycles: free -> unavailable -> preferred -> free
  async function cycle(date) {
    const current = byDate.get(date);
    const next = current === undefined ? 'unavailable'
               : current === 'unavailable' ? 'preferred'
               : null;

    setError('');
    try {
      if (next === null) await api.clearAvailability(date);
      else await api.setAvailability({ date, status: next });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (status === 'loading') return <p className="muted">Loading...</p>;

  return (
    <div>
      <h2 className="h2">My availability</h2>
      <p className="muted small">
        Click a day to cycle through available, unavailable and preferred.
        The generator treats unavailable as a hard rule and preferred as a nudge.
      </p>

      {error && <p className="alert">{error}</p>}

      <div className="cal">
        {dates.map((date) => {
          const state = byDate.get(date);
          const d = new Date(date + 'T00:00:00Z');
          return (
            <button
              key={date}
              className={'cal__day' + (state ? ` cal__day--${state}` : '')}
              onClick={() => cycle(date)}
            >
              <span className="cal__dow">
                {d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}
              </span>
              <span className="cal__num">{d.getUTCDate()}</span>
              <span className="cal__mon">
                {d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}
              </span>
            </button>
          );
        })}
      </div>

      <div className="legend">
        <span><i className="dot" /> available</span>
        <span><i className="dot dot--unavailable" /> unavailable</span>
        <span><i className="dot dot--preferred" /> preferred</span>
      </div>
    </div>
  );
}
