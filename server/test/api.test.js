import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

// A throwaway database per run, set before db.js is imported, so these tests
// never touch the real one.
const TEST_DB = './data/test-api.db';
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret-not-the-real-one';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');

let server;
let base;

before(async () => {
  // Port 0 means "any free port", so tests never collide with a dev server
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  server.close();
  db.close();
  await rm(TEST_DB, { force: true });
});

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe('registration', () => {
  test('the first account created becomes the manager', async () => {
    const res = await call('/auth/register', {
      method: 'POST',
      body: { name: 'First Boss', email: 'boss@test.com', password: 'password123' }
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'manager');
  });

  test('later accounts are staff even if they ask to be manager', async () => {
    const res = await call('/auth/register', {
      method: 'POST',
      body: { name: 'Climber', email: 'climber@test.com', password: 'password123', role: 'manager' }
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'staff', 'a client must not be able to grant itself a role');
  });

  test('a short password is rejected', async () => {
    const res = await call('/auth/register', {
      method: 'POST',
      body: { name: 'X', email: 'short@test.com', password: 'short' }
    });

    assert.equal(res.status, 400);
  });

  test('a duplicate email is rejected', async () => {
    const res = await call('/auth/register', {
      method: 'POST',
      body: { name: 'Again', email: 'boss@test.com', password: 'password123' }
    });

    assert.equal(res.status, 409);
  });

  test('the password hash is never returned', async () => {
    const res = await call('/auth/register', {
      method: 'POST',
      body: { name: 'Checker', email: 'checker@test.com', password: 'password123' }
    });

    assert.ok(!JSON.stringify(res.body).includes('password_hash'));
    assert.ok(!JSON.stringify(res.body).includes('password123'));
  });
});

describe('login', () => {
  test('correct details return a token', async () => {
    const res = await call('/auth/login', {
      method: 'POST',
      body: { email: 'boss@test.com', password: 'password123' }
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  test('a wrong password is rejected', async () => {
    const res = await call('/auth/login', {
      method: 'POST',
      body: { email: 'boss@test.com', password: 'wrongpassword' }
    });

    assert.equal(res.status, 401);
  });

  test('an unknown email gives exactly the same answer as a wrong password', async () => {
    // Any difference here, in wording or in status, tells an attacker which
    // addresses are registered.
    const unknown = await call('/auth/login', {
      method: 'POST', body: { email: 'nobody@test.com', password: 'password123' }
    });
    const wrongPassword = await call('/auth/login', {
      method: 'POST', body: { email: 'boss@test.com', password: 'wrongpassword' }
    });

    assert.equal(unknown.status, wrongPassword.status);
    assert.deepEqual(unknown.body, wrongPassword.body);
  });
});

describe('protected routes', () => {
  let managerToken;
  let staffToken;

  before(async () => {
    managerToken = (await call('/auth/login', {
      method: 'POST', body: { email: 'boss@test.com', password: 'password123' }
    })).body.token;

    staffToken = (await call('/auth/login', {
      method: 'POST', body: { email: 'climber@test.com', password: 'password123' }
    })).body.token;
  });

  test('no token is 401', async () => {
    assert.equal((await call('/staff')).status, 401);
  });

  test('a rubbish token is 401', async () => {
    assert.equal((await call('/staff', { token: 'not.a.token' })).status, 401);
  });

  test('a valid token gets through', async () => {
    const res = await call('/staff', { token: staffToken });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.staff));
  });

  test('staff cannot add people (403, not 401)', async () => {
    const res = await call('/staff', {
      method: 'POST', token: staffToken,
      body: { name: 'Sneaky', email: 'sneaky@test.com', password: 'password123' }
    });

    assert.equal(res.status, 403, '403 means we know who you are and the answer is no');
  });

  test('a manager can add people', async () => {
    const res = await call('/staff', {
      method: 'POST', token: managerToken,
      body: { name: 'New Hire', email: 'hire@test.com', password: 'password123' }
    });

    assert.equal(res.status, 201);
  });

  test('a manager cannot delete their own account', async () => {
    const me = (await call('/auth/me', { token: managerToken })).body.user;
    const res = await call(`/staff/${me.id}`, { method: 'DELETE', token: managerToken });

    assert.equal(res.status, 400);
  });
});

describe('schedules', () => {
  let managerToken;
  let staffToken;

  before(async () => {
    managerToken = (await call('/auth/login', {
      method: 'POST', body: { email: 'boss@test.com', password: 'password123' }
    })).body.token;
    staffToken = (await call('/auth/login', {
      method: 'POST', body: { email: 'climber@test.com', password: 'password123' }
    })).body.token;
  });

  test('creating one makes a slot for every day and shift type', async () => {
    const res = await call('/schedules', {
      method: 'POST', token: managerToken,
      body: { name: 'Test week', start_date: '2026-03-02', end_date: '2026-03-08', required_staff: 2 }
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.shifts, 21, '7 days x 3 shifts');
  });

  test('staff cannot create one', async () => {
    const res = await call('/schedules', {
      method: 'POST', token: staffToken,
      body: { name: 'Nope', start_date: '2026-03-02', end_date: '2026-03-08' }
    });

    assert.equal(res.status, 403);
  });

  test('an end date before the start is rejected', async () => {
    const res = await call('/schedules', {
      method: 'POST', token: managerToken,
      body: { name: 'Backwards', start_date: '2026-03-08', end_date: '2026-03-02' }
    });

    assert.equal(res.status, 400);
  });

  test('an absurdly long range is rejected', async () => {
    const res = await call('/schedules', {
      method: 'POST', token: managerToken,
      body: { name: 'Forever', start_date: '2026-01-01', end_date: '2027-01-01' }
    });

    assert.equal(res.status, 400);
  });

  test('a failed create leaves nothing behind', async () => {
    // The shifts and the schedule row are written in one transaction, so a
    // rejected request must not leave a half-built schedule in the list.
    const before = (await call('/schedules', { token: managerToken })).body.schedules.length;

    await call('/schedules', {
      method: 'POST', token: managerToken,
      body: { name: 'Bad', start_date: '2026-03-08', end_date: '2026-03-02' }
    });

    const after = (await call('/schedules', { token: managerToken })).body.schedules.length;
    assert.equal(after, before);
  });
});

describe('availability', () => {
  let staffToken;

  before(async () => {
    staffToken = (await call('/auth/login', {
      method: 'POST', body: { email: 'climber@test.com', password: 'password123' }
    })).body.token;
  });

  test('setting the same day twice replaces rather than duplicates', async () => {
    await call('/availability', {
      method: 'PUT', token: staffToken, body: { date: '2026-03-03', status: 'unavailable' }
    });
    await call('/availability', {
      method: 'PUT', token: staffToken, body: { date: '2026-03-03', status: 'preferred' }
    });

    const res = await call('/availability', { token: staffToken });
    const forThatDay = res.body.entries.filter((e) => e.date === '2026-03-03');

    assert.equal(forThatDay.length, 1);
    assert.equal(forThatDay[0].status, 'preferred');
  });

  test('a bad date format is rejected', async () => {
    const res = await call('/availability', {
      method: 'PUT', token: staffToken, body: { date: '3rd March', status: 'unavailable' }
    });

    assert.equal(res.status, 400);
  });

  test('an invented status is rejected', async () => {
    const res = await call('/availability', {
      method: 'PUT', token: staffToken, body: { date: '2026-03-04', status: 'maybe' }
    });

    assert.equal(res.status, 400);
  });

  test('staff cannot read someone else\'s availability', async () => {
    const res = await call('/availability?user_id=1', { token: staffToken });
    assert.equal(res.status, 403);
  });
});
