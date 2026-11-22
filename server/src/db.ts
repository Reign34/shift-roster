import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Everything that touches the database goes through this file. Keeping it in
// one place is what will make the move to Postgres a contained job later
// instead of a rewrite.
const DB_PATH = resolve(process.env.DB_PATH || './data/roster.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// Off by default in SQLite, which silently allows orphaned rows
db.exec('PRAGMA foreign_keys = ON');

// Wraps a function so every statement inside it either all happens or none
// of it does. Needed wherever a half-finished write would leave bad data:
// a schedule with only some of its shifts, or a swap that closed the request
// without actually moving the shift.
//
// The generics keep the wrapped function's own arguments and return type,
// so calling it still type-checks exactly as the original did.
export function transaction<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  return (...args: Args): Result => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

// node:sqlite returns rows as null-prototype objects typed loosely, so each
// query site says what it expects. This helper keeps that to one cast rather
// than scattering `as` through the route files.
export function queryOne<T>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function queryAll<T>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff')),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- The three slots a 24/7 operation runs on
    CREATE TABLE IF NOT EXISTS shift_types (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      start_time TEXT NOT NULL,
      end_time   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      start_date TEXT    NOT NULL,
      end_date   TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per slot that needs filling: a date plus a shift type
    CREATE TABLE IF NOT EXISTS shifts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id    INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      date           TEXT    NOT NULL,
      shift_type_id  INTEGER NOT NULL REFERENCES shift_types(id),
      required_staff INTEGER NOT NULL DEFAULT 7,
      UNIQUE (schedule_id, date, shift_type_id)
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (shift_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS availability (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date    TEXT    NOT NULL,
      status  TEXT    NOT NULL CHECK (status IN ('unavailable', 'preferred')),
      note    TEXT,
      UNIQUE (user_id, date)
    );

    CREATE TABLE IF NOT EXISTS swap_requests (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id  INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      requester_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status         TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- The queries that will run most often: "who is on this shift" and
    -- "when is this person unavailable"
    CREATE INDEX IF NOT EXISTS idx_shifts_schedule    ON shifts(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_shift  ON assignments(shift_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_user   ON assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_availability_user  ON availability(user_id, date);
  `);

  // A 24/7 operation needs the day covered end to end with no gaps
  const existing = queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM shift_types');
  if (existing && existing.n === 0) {
    const insert = db.prepare(
      'INSERT INTO shift_types (name, start_time, end_time) VALUES (?, ?, ?)'
    );
    insert.run('Morning', '06:00', '14:00');
    insert.run('Afternoon', '14:00', '22:00');
    insert.run('Night', '22:00', '06:00');
  }
}
