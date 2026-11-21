# Shift Roster

Scheduling tool for a 24/7 operation. Managers build a rota across three daily
shifts, staff mark when they can't work, and the roster can be generated
automatically so the load stays even.

I started this because building duty rosters by hand is miserable. The same
four problems come up every time: keeping it fair, working around who's
unavailable, redoing everything when one person swaps out, and rebuilding the
whole thing from scratch each week.

**Work in progress.** Phase 1 (the API and authentication) is done.

## Status

- [x] **Phase 1** — API, database schema, register/login, role-based access
- [ ] **Phase 2** — React frontend, staff management
- [ ] **Phase 3** — Build a schedule, assign people, mark availability
- [ ] **Phase 4** — Generate a roster automatically, balanced for fairness
- [ ] **Phase 5** — Swap requests
- [ ] **Phase 6** — Deploy

## Stack

Node and Express for the API, SQLite through Node's built-in `node:sqlite`,
and React with Vite for the frontend. Authentication is written by hand with
`scrypt` and JSON Web Tokens rather than an auth service, because the point
was to understand what those services are doing.

SQLite keeps setup to nothing: no database to install, no connection string.
All the SQL lives in `server/src/db.js`, so moving to Postgres later is a
contained job rather than a rewrite.

## Running it

```bash
cd server
npm install
cp .env.example .env     # then put a real secret in it
npm run seed             # creates a manager and 33 staff
npm run dev
```

The seed prints the login. Every seeded account uses the same demo password.

## The shift model

A 24/7 operation needs the full day covered, so there are three shifts:

| Shift | Hours |
|---|---|
| Morning | 06:00 – 14:00 |
| Afternoon | 14:00 – 22:00 |
| Night | 22:00 – 06:00 |

That's 21 shifts a week. At 7 people per shift it needs 147 person-shifts,
and 33 staff working 5 days each gives 165. Tight but workable, which is
what makes the fairness part in Phase 4 actually interesting: there isn't much
slack, so a naive assignment leaves someone doing three nights in a row.

## Notes

### Passwords

Stored as a `scrypt` hash with a random per-user salt, never as text. The salt
means two people who pick the same password still get different hashes, so
cracking one doesn't crack the other.

Comparison uses `timingSafeEqual` rather than `===`. A normal string compare
returns as soon as it finds a difference, so the time it takes leaks how much
of the hash you guessed correctly.

### Logging in with an email that doesn't exist

The obvious version returns early when no user is found. That's measurably
faster than a real login, so someone can time the responses and work out which
emails are registered. Instead it hashes against a dummy value and returns the
identical message either way.

### What's inside a JWT

Not encryption. The payload is base64 and anyone holding the token can read it:

```json
{ "sub": 1, "role": "manager", "name": "Rota Manager", "iat": ..., "exp": ... }
```

What they can't do is change it, because the signature wouldn't match without
the server's secret. So a token can carry who you are, but never anything
private.

### The token says who, the database says what

`requireAuth` reads the user row on every request rather than trusting the
role in the token. Tokens last a week, so a role change or a deleted account
would otherwise take up to seven days to take effect.

### 401 vs 403

401 means "I don't know who you are", 403 means "I know, and the answer is no".
Mixing them up makes the frontend impossible to write, because it can't tell
when to redirect to the login page.

### Self-promotion

`POST /api/auth/register` accepts a `role` field and deliberately ignores it.
The first account created becomes the manager so there's a way to bootstrap;
everyone after is staff until an existing manager promotes them.

## API

| Method | Route | Who |
|---|---|---|
| POST | `/api/auth/register` | anyone |
| POST | `/api/auth/login` | anyone |
| GET | `/api/auth/me` | signed in |
| GET | `/api/staff` | signed in |
| POST | `/api/staff` | manager |
| DELETE | `/api/staff/:id` | manager |

## Layout

```
server/
├── src/
│   ├── index.js          express app and error handling
│   ├── db.js             connection, schema, all the SQL
│   ├── auth.js           hashing and tokens
│   ├── middleware.js     requireAuth, requireManager
│   ├── seed.js           demo data
│   └── routes/
│       ├── auth.js
│       └── staff.js
└── .env.example
```
