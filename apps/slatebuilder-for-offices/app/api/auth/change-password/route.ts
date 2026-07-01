import { NextRequest, NextResponse } from "next/server";
import { getOfficeStore } from "../../../../lib/store";
import { hashPassword, readSessionToken, sessionCookie, verifyPassword } from "../../../../lib/auth";

export const runtime = "nodejs";

// Change password while signed in. The office key is unchanged: the client
// re-wraps the same key under the new password (so tokens and existing data
// stay valid) and sends the new wrapped key here.
export async function POST(req: NextRequest) {
  const officeId = readSessionToken(req.cookies.get(sessionCookie.name)?.value);
  if (!officeId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  const newWrappedOfficeKey = body?.newWrappedOfficeKey;
  if (newPassword.length < 8 || !newWrappedOfficeKey?.ciphertext) {
    return NextResponse.json({ error: "An 8+ character new password is required." }, { status: 400 });
  }

  const store = getOfficeStore();
  const office = await store.get(officeId);
  if (!office || !verifyPassword(currentPassword, office.pwHash)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  await store.update(officeId, {
    pwHash: hashPassword(newPassword),
    wrappedOfficeKey: newWrappedOfficeKey,
  });
  return NextResponse.json({ ok: true });
}
