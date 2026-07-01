import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Password hashing (scrypt) and a signed session cookie — no external deps.
// The session secret should be set via SESSION_SECRET in production.

const SESSION_COOKIE = "sb_office_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-insecure-session-secret";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(officeId: string): string {
  const payload = Buffer.from(JSON.stringify({ officeId, iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const { officeId, iat } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof officeId !== "string" || typeof iat !== "number") return null;
    if (Date.now() - iat > SESSION_TTL_MS) return null;
    return officeId;
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: SESSION_COOKIE,
  serialize(value: string): string {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  },
  clear(): string {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  },
};
