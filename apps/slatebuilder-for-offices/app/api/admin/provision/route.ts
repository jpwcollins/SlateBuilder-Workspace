import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  generateOfficeKey,
  keyCheckValue,
  wrapOfficeKey,
  bytesToBase64Url,
} from "@slatebuilder/core";
import { getOfficeStore } from "../../../../lib/store";
import { hashPassword } from "../../../../lib/auth";
import { clientIp, rateLimit } from "../../../../lib/rateLimit";

export const runtime = "nodejs";

function adminSecretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch rather than just returning
  // false, and a length check itself leaks length via timing -- but the
  // secret's length isn't sensitive the way its content is, so this is fine.
  return a.length === b.length && timingSafeEqual(a, b);
}

// Admin-only office provisioning (offices cannot self-register). Guarded by the
// ADMIN_SECRET env var. Generates a random office key, wraps it under the chosen
// password, and stores only the wrapped key + a key-check value + the password
// hash. Returns the one-time recovery code (the office key) for the admin to
// hand to the office; it is never stored in recoverable form.
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ipLimit = await rateLimit(`admin-provision:ip:${ip}`, 10, 900);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || !adminSecretMatches(req.headers.get("x-admin-secret"), adminSecret)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const officeId = String(body?.officeId ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const overwrite = Boolean(body?.overwrite);
  if (!officeId || password.length < 8) {
    return NextResponse.json(
      { error: "officeId and an 8+ character password are required." },
      { status: 400 }
    );
  }

  if (overwrite) {
    // Overwriting destroys the existing office's password and synced data
    // (a fresh key + fresh state). There's no separate confirmation step at
    // this layer (this endpoint is only reachable with ADMIN_SECRET), but log
    // it so a leaked/guessed secret used this way leaves a trace.
    console.warn(`admin/provision: overwriting existing office "${officeId}" from ip ${ip}`);
  }

  const officeKey = generateOfficeKey();
  const created = await getOfficeStore().create(
    {
      officeId,
      pwHash: hashPassword(password),
      wrappedOfficeKey: await wrapOfficeKey(password, officeKey),
      keyCheck: await keyCheckValue(officeKey),
      stateCiphertext: null,
      stateVersion: 0,
      updatedAt: new Date().toISOString(),
    },
    overwrite
  );
  if (!created) {
    return NextResponse.json({ error: "Office already exists (pass overwrite:true to reset)." }, {
      status: 409,
    });
  }

  return NextResponse.json({ officeId, recoveryCode: bytesToBase64Url(officeKey), overwrite });
}
