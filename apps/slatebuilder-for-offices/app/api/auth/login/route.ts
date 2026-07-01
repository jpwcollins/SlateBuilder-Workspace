import { NextRequest, NextResponse } from "next/server";
import { getOfficeStore } from "../../../../lib/store";
import { createSessionToken, sessionCookie, verifyPassword } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const officeId = String(body?.officeId ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  const store = getOfficeStore();
  const office = await store.get(officeId);
  if (!office || !verifyPassword(password, office.pwHash)) {
    return NextResponse.json({ error: "Wrong office name or password." }, { status: 401 });
  }

  // Return the wrapped office key so the client can unwrap it with the password.
  const res = NextResponse.json({ officeId, wrappedOfficeKey: office.wrappedOfficeKey });
  res.headers.set("Set-Cookie", sessionCookie.serialize(createSessionToken(officeId)));
  return res;
}
