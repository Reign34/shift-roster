import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';

export default function Staff() {
  const { isManager, user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' });

  async function load() {
    try {
      const { staff } = await api.staff();
      setStaff(staff);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  useEffect(() => { load(); }, []);

  async function add(event) {
    event.preventDefault();
    setError('');
    try {
      await api.addStaff(form);
      setForm({ name: '', email: '', password: '', role: 'staff' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(person) {
    if (!confirm(`Remove ${person.name}? Their assignments go too.`)) return;
    try { await api.removeStaff(person.id); load(); }
    catch (err) { setError(err.message); }
  }

  if (status === 'loading') return <p className="muted">Loading team...</p>;

  return (
    <div>
      <div className="row row--between">
        <h2 className="h2">Team <span className="muted">({staff.length})</span></h2>
        {isManager && (
          <button className="btn btn--primary btn--sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Add person'}
          </button>
        )}
      </div>

      {error && <p className="alert">{error}</p>}

      {showForm && (
        <form className="card form-grid" onSubmit={add}>
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input" value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            <span className="field__label">Email</span>
            <input className="input" type="email" value={form.email}
                   onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input className="input" type="password" minLength={8} value={form.password}
                   onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
          <label className="field">
            <span className="field__label">Role</span>
            <select className="input" value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="staff">staff</option>
              <option value="manager">manager</option>
            </select>
          </label>
          <button className="btn btn--primary">Add</button>
        </form>
      )}

      <ul className="list list--tight">
        {staff.map((person) => (
          <li key={person.id} className="card row row--between">
            <div>
              <strong>{person.name}</strong>
              {person.id === user.id && <span className="pill pill--you">you</span>}
              <p className="muted small">{person.email}</p>
            </div>
            <div className="row">
              <span className={'pill' + (person.role === 'manager' ? ' pill--good' : '')}>
                {person.role}
              </span>
              {isManager && person.id !== user.id && (
                <button className="btn btn--ghost btn--sm" onClick={() => remove(person)}>
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
