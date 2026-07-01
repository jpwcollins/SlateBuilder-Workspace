import { NextRequest, NextResponse } from "next/server";
import {
  generateOfficeKey,
  keyCheckValue,
  wrapOfficeKey,
  bytesToBase64Url,
} from "@slatebuilder/core";
import { getOfficeStore } from "../../../../lib/store";
import { hashPassword } from "../../../../lib/auth";

export const runtime = "nodejs";

// Admin-only office provisioning (offices cannot self-register). Guarded by the
// ADMIN_SECRET env var. Generates a random office key, wraps it under the chosen
// password, and stores only the wrapped key + a key-check value + the password
// hash. Returns the one-time recovery code (the office key) for the admin to
// hand to the office; it is never stored in recoverable form.
export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const officeId = String(body?.officeId ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const overwrite = Boolean(body?.overwrite);
  if (!officeId || password.length < 4) {
    return NextResponse.json({ error: "officeId and a password are required." }, { status: 400 });
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
