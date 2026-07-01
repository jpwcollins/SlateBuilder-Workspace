import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Unauthenticated deployment probe. If this 404s, the deployment you are hitting
// does not include the sync API (wrong URL — likely production/main instead of
// the feature branch preview). `store: "redis"` confirms the Upstash env vars
// are detected; "memory" means they are not.
export async function GET() {
  const store =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL ? "redis" : "memory";
  return NextResponse.json({
    ok: true,
    feature: "office-collab-sync",
    store,
    adminConfigured: Boolean(process.env.ADMIN_SECRET),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
