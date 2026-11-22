import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role, User } from './types.ts';

// Passwords are hashed with scrypt, which is built into Node. bcrypt is the
// more familiar name but needs a native module; scrypt is the same idea and
// is designed for exactly this.
//
// The two rules that matter:
//   1. Never store the password itself. Store a hash it cannot be reversed from.
//   2. Give every password its own random salt, so two people who happen to
//      pick the same password still get different hashes.
const KEY_LENGTH = 64;

export type TokenPayload = {
  sub: number;
  role: Role;
  name: string;
  iat: number;
  exp: number;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;        // the salt is stored alongside, not secret
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, KEY_LENGTH);

  // timingSafeEqual instead of === because a normal comparison returns faster
  // when the first characters differ, which leaks information about the hash.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// A JWT is three base64 parts: who the user is, plus a signature made with a
// secret only the server knows. Anyone can read the contents, so nothing
// private goes inside, but nobody can forge one without the secret.
export function signToken(user: Pick<User, 'id' | 'role' | 'name'>): string {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    requireSecret(),
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    // jwt.verify is typed as string | JwtPayload because a token can carry
    // a bare string. Ours never does, so this narrows through unknown.
    return jwt.verify(token, requireSecret()) as unknown as TokenPayload;
  } catch {
    return null;                   // expired, tampered with, or nonsense
  }
}

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  // Falling back to a default here would mean anyone who read this repo could
  // mint valid tokens for a deployed copy. Better to refuse to start.
  if (!secret) throw new Error('JWT_SECRET is not set. Copy .env.example to .env.');
  return secret;
}
