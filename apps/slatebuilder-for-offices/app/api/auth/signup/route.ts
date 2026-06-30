import { NextRequest, NextResponse } from "next/server";
import { getOfficeStore } from "../../../../lib/store";
import { createSessionToken, hashPassword, sessionCookie } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const officeId = String(body?.officeId ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const wrappedOfficeKey = body?.wrappedOfficeKey;

  if (!officeId || password.length < 8 || !wrappedOfficeKey?.ciphertext) {
    return NextResponse.json(
      { error: "Office name, an 8+ character password, and a wrapped key are required." },
      { status: 400 }
    );
  }

  const store = getOfficeStore();
  const created = await store.create({
    officeId,
    pwHash: hashPassword(password),
    wrappedOfficeKey,
    stateCiphertext: null,
    stateVersion: 0,
    updatedAt: new Date().toISOString(),
  });
  if (!created) {
    return NextResponse.json({ error: "That office name is already taken." }, { status: 409 });
  }

  const res = NextResponse.json({ officeId });
  res.headers.set("Set-Cookie", sessionCookie.serialize(createSessionToken(officeId)));
  return res;
}
