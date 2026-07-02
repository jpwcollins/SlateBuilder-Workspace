import { NextRequest, NextResponse } from "next/server";
import { getOfficeStore } from "../../../../lib/store";
import { createSessionToken, sessionCookie, verifyPassword } from "../../../../lib/auth";
import { clientIp, rateLimit } from "../../../../lib/rateLimit";

export const runtime = "nodejs";

// A structurally valid (but unusable) hash to run verifyPassword against when
// the office doesn't exist, so an unknown officeId costs the same scrypt time
// as a wrong password for a real one — otherwise the timing difference lets
// an attacker enumerate valid office IDs without ever seeing an error message
// that says so.
const DUMMY_PW_HASH = `${"0".repeat(32)}:${"0".repeat(64)}`;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ipLimit = await rateLimit(`login:ip:${ip}`, 20, 300);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const officeId = String(body?.officeId ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  const officeLimit = await rateLimit(`login:office:${officeId}`, 10, 300);
  if (!officeLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const store = getOfficeStore();
  const office = await store.get(officeId);
  const passwordOk = verifyPassword(password, office?.pwHash ?? DUMMY_PW_HASH);
  if (!office || !passwordOk) {
    return NextResponse.json({ error: "Wrong office name or password." }, { status: 401 });
  }

  // Return the wrapped office key so the client can unwrap it with the password.
  const res = NextResponse.json({ officeId, wrappedOfficeKey: office.wrappedOfficeKey });
  res.headers.set("Set-Cookie", sessionCookie.serialize(createSessionToken(officeId)));
  return res;
}
