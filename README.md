# Shift Roster

Scheduling tool for an operation that runs 24/7. Managers build a rota across
three daily shifts, staff mark the days they can't work, and the roster can be
generated automatically so the load stays even.

I built this because making duty rosters by hand is miserable, and the same
four problems come up every time:

| The problem | What the app does |
|---|---|
| Keeping it fair | Generator balances total shifts and nights separately |
| Availability clashes | Staff mark their own days; the generator treats those as hard rules |
| Last-minute swaps | Staff offer a shift, someone else takes it, coverage is preserved |
| Rebuilding every week | Create a schedule from dates and generate; nothing is retyped |

## Features

**Managers** create schedules, generate rosters, override assignments by hand,
publish, and manage the team.

**Staff** see their own shifts, mark availability as unavailable or preferred,
offer shifts for swap and pick up other people's.

## Stack

TypeScript on Node with Express for the API, SQLite through Node's built-in
`node:sqlite`, React with Vite and React Router on the frontend. Authentication is written by
hand with `scrypt` and JSON Web Tokens rather than an auth service, because the
point was to understand what those services do.

SQLite means no database to install. All the SQL is in `server/src/db.js`, so
moving to Postgres later is a contained job rather than a rewrite.

## Running it

Two terminals.

```bash
cd server
npm install
cp .env.example .env     # then put a real secret in it
npm run seed             # a manager and 33 staff
npm run dev              # runs the .ts files directly, no build step
npm run typecheck        # tsc --noEmit
npm test
```

```bash
cd client
npm install
npm run dev
```

The seed prints the login. Every seeded account shares the same demo password.

## The shift model

Three shifts cover the full day:

| Shift | Hours |
|---|---|
| Morning | 06:00 – 14:00 |
| Afternoon | 14:00 – 22:00 |
| Night | 22:00 – 06:00 |

21 shifts a week. At 7 people each that needs 147 person-shifts; 33 staff
working at most 5 days each gives 165. The margin is thin, which is what makes
the generator worth having: a naive assignment leaves someone on three nights
in a row while someone else does two shifts all week.

## How the generator works

Hard rules, which are never broken:

- not on a day they marked unavailable
- never two shifts in one day
- a day off after a night shift
- at most 5 shifts in the period

Soft rules, which decide between everyone still eligible. Each is a number
added to a score, and the lowest score wins:

```js
let score = person.total * 100;                 // fewest shifts goes first
if (isNight) score += person.nights * 60;       // spread the nights too
if (workedYesterday) score += person.streak * 15;
if (preferredThisDay) score -= 40;
score += Math.random() * 10;                    // break ties differently each run
```

Shifts are filled in date order, because "did they work yesterday" is only
knowable once yesterday is done. It's greedy rather than a proper constraint
solver, so it isn't guaranteed optimal, but it runs instantly and on the test
data it fills all 147 slots with everyone on 4–5 shifts and 1–2 nights.

When it can't fill something it says so rather than quietly producing a roster
with a hole in the night shift.

### Verified, not assumed

The generator reports its own fairness numbers, which is exactly the kind of
thing that can be wrong and look right. The four hard rules are covered by the
test suite below, and were also checked by querying the database directly
after a real run.

## Tests

```bash
cd server
npm test
```

47 tests using Node's built-in test runner, so there's no test framework to
install. Three files:

| File | Covers |
|---|---|
| `generator.test.js` | the four hard rules, fairness spread, coverage, edge cases |
| `auth.test.js` | hashing, salting, token signing and forgery |
| `api.test.js` | registration, login, roles, schedules, availability |

The API tests run the real Express app on a throwaway port against a
temporary database, so they exercise the actual routes rather than mocks.

### The tests were wrong before they were right

A passing test proves nothing on its own. To check these actually catch
anything, I broke the code on purpose, one rule at a time, and confirmed the
suite went red each time.

The first attempt was a failure, and a useful one. I deleted the
"day off after a night shift" rule from the generator entirely — **and all
14 tests still passed.**

The reason: that test ran against the full roster of 33 staff covering 7 per
shift. There is so much slack there that nobody is ever *needed* the day after
a night, so the rule never actually gets exercised. The test was watching a
situation that could not go wrong.

The fix was to make the scenario tight enough that the constraint binds: 7
people covering 2 per shift, where the generator has no choice but to consider
someone who worked last night. With the rule deleted that produces 5
violations; with it in place, none.

Five mutations in total, all caught after that fix:

| Rule removed | Tests that went red |
|---|---|
| day off after nights | 1 |
| unavailable days | 2 |
| one shift per day | 1 |
| self-promotion guard on register | 4 |
| `requireManager` role check | 2 |

The lesson worth keeping: when a test passes, ask whether it *could* have
failed. A test that watches a situation that can't go wrong is just a slower
way of writing nothing.

## TypeScript

The server is TypeScript with **no build step**. Node 24 runs `.ts` files
directly by stripping the type annotations out, so `node src/index.ts` just
works and there is no `dist/` folder to keep in sync.

The catch, and it is an important one: **stripping is not checking.** Node
removes the types without looking at them, so this runs perfectly happily:

```ts
const n: number = "this is a string";   // node runs it, prints the string
```

Type checking is therefore a separate command, `npm run typecheck`, which runs
`tsc --noEmit`. Same compiler everyone else uses, just never asked to produce
output.

One quirk of running `.ts` natively: imports need the real extension,
`./db.ts`, not the `./db.js` that TypeScript projects usually write. That is
what `allowImportingTsExtensions` in the tsconfig is for.

### What the types actually caught

Converting was not just annotating what was already there. Turning `strict` on
surfaced four genuine problems:

**`req.params.id` can be undefined.** With `noUncheckedIndexedAccess`, reading
a route parameter gives `string | undefined`, and four places were passing
that straight into SQL. They are now `Number(req.params.id)`.

**`Math.min()` of an empty array is `Infinity`.** With no staff at all, the
fairness summary reported `minShifts: Infinity`, which becomes `null` once it
goes through `JSON.stringify` and out to the client. The existing test only
checked that no assignments were produced, so it never noticed. There is a
test for it now.

**`jwt.verify` returns `string | JwtPayload`**, because a token can legally
carry a bare string. Ours never does, but the compiler was right to make that
explicit rather than let it be assumed.

**The exact bug from before.** Writing `db.transaction(...)` out of habit, the
mistake that cost a debugging session when it showed up as a 500:

```
Property 'transaction' does not exist on type 'DatabaseSync'.
Did you mean 'isTransaction'?
```

Caught in the editor, before the file was even saved.

The honest limit, though: types catch *shape* mistakes. The swap bug further
down this page — forgetting that two people on the same shift could both end
up assigned to it — had perfectly correct types the entire time. Both ids were
numbers. The code was still wrong. That is what the tests are for.

A small example of what the types buy, from `types.ts`:

```ts
export type ShiftName = 'Morning' | 'Afternoon' | 'Night';
```

With that, `shift.shift_name === 'Nigth'` stops compiling instead of quietly
never matching anything.

## Notes

### Passwords

`scrypt` with a random per-user salt, never stored as text. The salt means two
people who pick the same password still get different hashes.

Comparison uses `timingSafeEqual`, not `===`. A normal string compare returns
as soon as it finds a difference, so how long it takes leaks how much of the
hash you guessed right.

### Logging in with an email that doesn't exist

The obvious version returns early when there's no user. That's measurably
faster than a real login, so someone can time responses and work out which
emails are registered. This one hashes against a dummy value and returns the
same message either way.

### What's inside a JWT

Not encryption. The payload is base64 and anyone with the token can read it:

```json
{ "sub": 1, "role": "manager", "name": "Rota Manager", "iat": ..., "exp": ... }
```

They can't change it, because the signature wouldn't match without the
server's secret. So a token can say who you are but must never carry anything
private.

### The token says who, the database says what

`requireAuth` reads the user row on every request instead of trusting the role
inside the token. Tokens last a week, so otherwise a demotion wouldn't take
effect for seven days.

### 401 vs 403

401 means "I don't know who you are", 403 means "I know, and no". Mixing them
up makes the frontend impossible to write, because it can't tell when to send
someone to the login page.

### Self-promotion

`POST /api/auth/register` accepts a `role` and deliberately ignores it. The
first account created becomes the manager so there's a way to bootstrap;
everyone after is staff until a manager promotes them.

### node:sqlite is not better-sqlite3

I wrote `db.transaction(...)` out of habit. That's a better-sqlite3 API and
`node:sqlite` doesn't have it, so every write that needed a transaction
returned a 500. There's a small `transaction()` helper in `db.js` now that
wraps BEGIN / COMMIT / ROLLBACK.

Transactions matter in two places here: creating a schedule writes 21 shift
rows and a schedule that got half of them would be worse than none, and
accepting a swap has to move the shift *and* close the request or neither.

### A bug worth keeping

Accepting a swap returned a 500. A shift holds several people, so the roster
had put both the person offering and the person accepting on the same shift,
and reassigning produced a duplicate the UNIQUE constraint rejected. My clash
check only looked for conflicts on *other* shifts that day.

The database caught it, which is the point of having the constraint, but a
constraint violation reaching the user as "something went wrong" is a bug in
its own right. Now it's a 409 saying "you are already on that shift".

### The third auth state

`AuthContext` tracks `checking`, `signed-in` and `signed-out`, not just a
boolean. On a refresh there's a token in localStorage but no user yet, and
without the third state the app flashes the login screen before deciding you
were signed in after all.

## API

| Method | Route | Who |
|---|---|---|
| POST | `/api/auth/register` | anyone |
| POST | `/api/auth/login` | anyone |
| GET | `/api/auth/me` | signed in |
| GET | `/api/staff` | signed in |
| POST / DELETE | `/api/staff`, `/api/staff/:id` | manager |
| GET | `/api/schedules`, `/api/schedules/:id` | signed in |
| POST | `/api/schedules` | manager |
| POST | `/api/schedules/:id/generate` | manager |
| POST | `/api/schedules/:id/publish` | manager |
| POST | `/api/schedules/shifts/:id/assign` | manager |
| DELETE | `/api/schedules/assignments/:id` | manager |
| GET / PUT / DELETE | `/api/availability` | own, managers can read any |
| GET | `/api/swaps`, `/api/swaps/my-shifts` | signed in |
| POST | `/api/swaps`, `/api/swaps/:id/accept\|decline\|cancel` | signed in |

## Layout

```
server/src/
├── index.ts          starts the server
├── app.ts            express app and error handling
├── db.ts             connection, schema, transaction helper
├── types.ts          the shapes everything else shares
├── auth.ts           hashing and tokens
├── middleware.ts     requireAuth, requireManager
├── generator.ts      the fairness algorithm
├── seed.ts
└── routes/           auth, staff, schedules, availability, swaps

client/src/
├── App.jsx           routing and the protected shell
├── AuthContext.jsx   who is signed in
├── api.js            one place that talks to the server
└── pages/            Login, Schedules, ScheduleDetail, MyShifts,
                      Availability, Staff
```

## Still to do

- Deploy it (move to Postgres at the same time)
- Recurring schedule templates
- Email or push when a swap is offered
- Per-person shift preferences (someone who *wants* nights)
