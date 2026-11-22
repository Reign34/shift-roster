import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// The secret is read lazily inside auth.js, so setting it here is enough
process.env.JWT_SECRET = 'test-secret-not-the-real-one';

const { hashPassword, verifyPassword, signToken, verifyToken } = await import('../src/auth.ts');

describe('password hashing', () => {
  test('the hash does not contain the password', () => {
    const hash = hashPassword('correct horse battery staple');
    assert.ok(!hash.includes('correct'));
    assert.ok(!hash.includes('battery'));
  });

  test('the right password verifies', () => {
    const hash = hashPassword('password123');
    assert.equal(verifyPassword('password123', hash), true);
  });

  test('the wrong password does not', () => {
    const hash = hashPassword('password123');
    assert.equal(verifyPassword('password124', hash), false);
    assert.equal(verifyPassword('', hash), false);
    assert.equal(verifyPassword('PASSWORD123', hash), false);
  });

  test('the same password hashes differently every time', () => {
    // If these matched, anyone who cracked one account would have cracked
    // everyone who picked the same password. That is what the salt prevents.
    const a = hashPassword('password123');
    const b = hashPassword('password123');

    assert.notEqual(a, b);
    assert.equal(verifyPassword('password123', a), true);
    assert.equal(verifyPassword('password123', b), true);
  });

  test('a malformed stored hash is rejected rather than throwing', () => {
    // login() verifies against a dummy value when the email is unknown, so
    // this path runs on every failed sign-in attempt
    assert.equal(verifyPassword('anything', 'x:00'), false);
    assert.equal(verifyPassword('anything', 'nonsense'), false);
    assert.equal(verifyPassword('anything', ''), false);
  });
});

describe('tokens', () => {
  const user = { id: 7, name: 'Test Person', role: 'manager' as const };

  test('a signed token verifies and carries the user', () => {
    const payload = verifyToken(signToken(user));

    assert.ok(payload, 'a freshly signed token should verify');
    assert.equal(payload.sub, 7);
    assert.equal(payload.role, 'manager');
  });

  test('a tampered token is rejected', () => {
    const token = signToken(user);
    const [header, body, signature] = token.split('.');

    // Rewrite the payload to claim manager on a staff account, keeping the
    // original signature. This is the attack the signature exists to stop.
    const forged = Buffer.from(JSON.stringify({ sub: 1, role: 'manager' }))
      .toString('base64url');

    assert.equal(verifyToken(`${header}.${forged}.${signature}`), null);
  });

  test('nonsense is rejected rather than throwing', () => {
    assert.equal(verifyToken('not.a.token'), null);
    assert.equal(verifyToken(''), null);
    assert.equal(verifyToken('abc'), null);
  });

  test('a token signed with a different secret is rejected', () => {
    const token = signToken(user);

    process.env.JWT_SECRET = 'a-completely-different-secret';
    assert.equal(verifyToken(token), null);

    process.env.JWT_SECRET = 'test-secret-not-the-real-one';
    assert.ok(verifyToken(token));      // and valid again once restored
  });

  test('the payload is readable by anyone, so it must hold nothing private', () => {
    // Not a security hole, but worth encoding as a test so nobody later
    // decides to put something sensitive in there.
    const token = signToken(user);
    const body = token.split('.')[1];
    assert.ok(body, 'a JWT should have three parts');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());

    assert.deepEqual(
      Object.keys(payload).sort(),
      ['exp', 'iat', 'name', 'role', 'sub']
    );
  });
});
