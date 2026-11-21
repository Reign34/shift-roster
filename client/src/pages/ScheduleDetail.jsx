import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';

const SHIFT_ORDER = ['Morning', 'Afternoon', 'Night'];

function dayLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export default function ScheduleDetail() {
  const { id } = useParams();
  const { isManager } = useAuth();

  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);     // output of the last generate
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [schedule, staffList] = await Promise.all([api.schedule(id), api.staff()]);
      setData(schedule);
      setStaff(staffList.staff);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  useEffect(() => { load(); }, [id]);

  // Shifts come back as a flat list; the grid needs them grouped by date
  const days = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    for (const shift of data.shifts) {
      if (!map.has(shift.date)) map.set(shift.date, {});
      map.get(shift.date)[shift.shift_name] = shift;
    }
    return [...map.entries()].map(([date, shifts]) => ({ date, shifts }));
  }, [data]);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const outcome = await api.generate(id);
      setResult(outcome);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    try { await api.publish(id); load(); } catch (err) { setError(err.message); }
  }

  async function drop(assignmentId) {
    try { await api.unassign(assignmentId); load(); } catch (err) { setError(err.message); }
  }

  async function add(shiftId, userId) {
    if (!userId) return;
    try { await api.assign(shiftId, Number(userId)); load(); }
    catch (err) { setError(err.message); }
  }

  if (status === 'loading') return <p className="muted">Loading roster...</p>;
  if (status === 'error') return <p className="alert">{error}</p>;

  return (
    <div>
      <div className="row row--between">
        <div>
          <h2 className="h2">{data.schedule.name}</h2>
          <p className="muted small">
            {data.schedule.start_date} to {data.schedule.end_date} &middot;{' '}
            <span className={data.schedule.status === 'published' ? 'pill pill--good' : 'pill'}>
              {data.schedule.status}
            </span>
          </p>
        </div>
        {isManager && (
          <div className="row">
            <button className="btn btn--primary btn--sm" onClick={generate} disabled={busy}>
              {busy ? 'Generating...' : 'Generate roster'}
            </button>
            {data.schedule.status !== 'published' && (
              <button className="btn btn--ghost btn--sm" onClick={publish}>Publish</button>
            )}
          </div>
        )}
      </div>

      {error && <p className="alert">{error}</p>}

      {result && (
        <div className="card">
          <h3 className="h3">Generated</h3>
          <p className="muted small">
            {result.assigned} slots filled.{' '}
            {result.gaps.length === 0
              ? 'Every shift is fully covered.'
              : `${result.gaps.length} shift(s) could not be filled.`}
          </p>

          {result.gaps.length > 0 && (
            <ul className="gaps">
              {result.gaps.map((g, i) => (
                <li key={i}>{g.date} {g.shift}: {g.filled} of {g.needed}</li>
              ))}
            </ul>
          )}

          <div className="spread">
            <span>Shifts per person: <strong>{result.fairness.spread.minShifts}&ndash;{result.fairness.spread.maxShifts}</strong></span>
            <span>Nights per person: <strong>{result.fairness.spread.minNights}&ndash;{result.fairness.spread.maxNights}</strong></span>
          </div>

          <details>
            <summary className="muted small">Per person</summary>
            <ul className="fairness">
              {result.fairness.people.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span className="muted">{p.total} shifts &middot; {p.nights} nights</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <div className="grid-head">
        <span />
        {SHIFT_ORDER.map((name) => <span key={name} className="grid-head__cell">{name}</span>)}
      </div>

      {days.map(({ date, shifts }) => (
        <div className="day-row" key={date}>
          <div className="day-row__date">{dayLabel(date)}</div>

          {SHIFT_ORDER.map((shiftName) => {
            const shift = shifts[shiftName];
            if (!shift) return <div className="slot" key={shiftName} />;

            const short = shift.people.length < shift.required_staff;
            return (
              <div className={'slot' + (short ? ' slot--short' : '')} key={shiftName}>
                <p className="slot__count">
                  {shift.people.length}/{shift.required_staff}
                  <span className="muted"> &middot; {shift.start_time}</span>
                </p>

                <ul className="people">
                  {shift.people.map((p) => (
                    <li key={p.assignment_id}>
                      {p.name}
                      {isManager && (
                        <button className="x" onClick={() => drop(p.assignment_id)} title="Remove">&times;</button>
                      )}
                    </li>
                  ))}
                </ul>

                {isManager && (
                  <select
                    className="add-select"
                    value=""
                    onChange={(e) => add(shift.id, e.target.value)}
                  >
                    <option value="">+ add</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
