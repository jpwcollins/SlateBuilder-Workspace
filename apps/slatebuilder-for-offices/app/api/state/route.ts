import { NextRequest, NextResponse } from "next/server";
import { getOfficeStore } from "../../../lib/store";
import { readSessionToken, sessionCookie } from "../../../lib/auth";

export const runtime = "nodejs";

function sessionOffice(req: NextRequest): string | null {
  return readSessionToken(req.cookies.get(sessionCookie.name)?.value);
}

// Returns the office's end-to-end-encrypted working blob and its version. The
// payload is opaque to the server (encrypted under the office key).
export async function GET(req: NextRequest) {
  const officeId = sessionOffice(req);
  if (!officeId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const office = await getOfficeStore().get(officeId);
  if (!office) return NextResponse.json({ error: "Unknown office." }, { status: 404 });

  return NextResponse.json({ ciphertext: office.stateCiphertext, version: office.stateVersion });
}

// Optimistic-concurrency save: the client sends the new ciphertext plus the
// version it last saw. A mismatch means someone else saved first → 409.
export async function PUT(req: NextRequest) {
  const officeId = sessionOffice(req);
  if (!officeId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ciphertext = body?.ciphertext;
  const expectedVersion = Number(body?.expectedVersion);
  if (!ciphertext?.ciphertext || !Number.isFinite(expectedVersion)) {
    return NextResponse.json({ error: "A sealed blob and expectedVersion are required." }, {
      status: 400,
    });
  }

  const store = getOfficeStore();
  const office = await store.get(officeId);
  if (!office) return NextResponse.json({ error: "Unknown office." }, { status: 404 });

  if (office.stateVersion !== expectedVersion) {
    return NextResponse.json(
      { error: "conflict", version: office.stateVersion },
      { status: 409 }
    );
  }

  const nextVersion = office.stateVersion + 1;
  await store.update(officeId, { stateCiphertext: ciphertext, stateVersion: nextVersion });
  return NextResponse.json({ version: nextVersion });
}
