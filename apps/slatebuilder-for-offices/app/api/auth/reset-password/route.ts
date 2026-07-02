import { NextRequest, NextResponse } from "next/server";
import { keyCheckValue, base64UrlToBytes } from "@slatebuilder/core";
import { getOfficeStore } from "../../../../lib/store";
import { createSessionToken, hashPassword, sessionCookie } from "../../../../lib/auth";
import { clientIp, rateLimit } from "../../../../lib/rateLimit";

export const runtime = "nodejs";

const GENERIC_ERROR = "Office or recovery code is incorrect.";

// Forgot-password reset, authorized by the recovery code (the office key). The
// server verifies SHA-256(recoveryCode) against the stored key-check value, so
// it never learns the key. The client re-wraps the same key under the new
// password (preserving all synced data), and we sign the office in.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ipLimit = await rateLimit(`reset:ip:${ip}`, 10, 900);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const officeId = String(body?.officeId ?? "").trim().toLowerCase();
  const recoveryCode = String(body?.recoveryCode ?? "").trim();
  const newPassword = String(body?.newPassword ?? "");
  const newWrappedOfficeKey = body?.newWrappedOfficeKey;
  if (!officeId || !recoveryCode || newPassword.length < 8 || !newWrappedOfficeKey?.ciphertext) {
    return NextResponse.json(
      { error: "Office, recovery code, and an 8+ character new password are required." },
      { status: 400 }
    );
  }

  const officeLimit = await rateLimit(`reset:office:${officeId}`, 10, 900);
  if (!officeLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const store = getOfficeStore();
  const office = await store.get(officeId);

  // Same generic error whether the office is unknown, the recovery code is
  // malformed, or it just doesn't match — an office-specific message here
  // would let an attacker enumerate valid office IDs for free.
  let check: string | null = null;
  try {
    check = await keyCheckValue(base64UrlToBytes(recoveryCode));
  } catch {
    // fall through with check left null
  }
  if (!office || !check || check !== office.keyCheck) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  await store.update(officeId, {
    pwHash: hashPassword(newPassword),
    wrappedOfficeKey: newWrappedOfficeKey,
  });

  const res = NextResponse.json({ ok: true, officeId });
  res.headers.set("Set-Cookie", sessionCookie.serialize(createSessionToken(officeId)));
  return res;
}
