import { NextRequest, NextResponse } from "next/server";
import { keyCheckValue, base64UrlToBytes } from "@slatebuilder/core";
import { getOfficeStore } from "../../../../lib/store";
import { createSessionToken, hashPassword, sessionCookie } from "../../../../lib/auth";

export const runtime = "nodejs";

// Forgot-password reset, authorized by the recovery code (the office key). The
// server verifies SHA-256(recoveryCode) against the stored key-check value, so
// it never learns the key. The client re-wraps the same key under the new
// password (preserving all synced data), and we sign the office in.
export async function POST(req: NextRequest) {
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

  const store = getOfficeStore();
  const office = await store.get(officeId);
  if (!office) return NextResponse.json({ error: "Unknown office." }, { status: 404 });

  let check: string;
  try {
    check = await keyCheckValue(base64UrlToBytes(recoveryCode));
  } catch {
    return NextResponse.json({ error: "Invalid recovery code." }, { status: 400 });
  }
  if (check !== office.keyCheck) {
    return NextResponse.json({ error: "Recovery code does not match this office." }, { status: 401 });
  }

  await store.update(officeId, {
    pwHash: hashPassword(newPassword),
    wrappedOfficeKey: newWrappedOfficeKey,
  });

  const res = NextResponse.json({ ok: true, officeId });
  res.headers.set("Set-Cookie", sessionCookie.serialize(createSessionToken(officeId)));
  return res;
}
