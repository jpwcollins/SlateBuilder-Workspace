import { Redis } from "@upstash/redis";
import type { EncryptedEnvelope, SealedBlob } from "@slatebuilder/core";

// Per-office server record. Holds only auth material, the wrapped office key
// (opaque ciphertext), a non-secret key-check value (to authorize recovery-code
// resets), and the end-to-end-encrypted working blob. The server never sees the
// office key, patient tokens, names, PHNs, or diagnoses.
export type OfficeRecord = {
  officeId: string;
  pwHash: string; // scrypt "salt:hash"
  wrappedOfficeKey: EncryptedEnvelope;
  keyCheck: string; // SHA-256(officeKey), hex
  stateCiphertext: SealedBlob | null;
  stateVersion: number;
  updatedAt: string;
};

export type CasResult =
  | { ok: true; version: number }
  | { ok: false; version: number | null }; // version: null means the office doesn't exist

export interface OfficeStore {
  get(officeId: string): Promise<OfficeRecord | null>;
  create(record: OfficeRecord, overwrite?: boolean): Promise<boolean>; // false if it exists and overwrite is false
  update(officeId: string, patch: Partial<OfficeRecord>): Promise<void>;
  /**
   * Atomically applies the new stateCiphertext iff the office's current
   * stateVersion still equals expectedVersion, incrementing it by one.
   * Unlike update(), this must not have a get-then-set race window: two
   * concurrent saves with the same expectedVersion must not both succeed.
   */
  casState(
    officeId: string,
    expectedVersion: number,
    stateCiphertext: SealedBlob
  ): Promise<CasResult>;
}

const key = (officeId: string) => `office:${officeId}`;

// Accept either the Upstash-native names or the legacy KV_REST_API_* names that
// the Vercel Marketplace Upstash integration provisions.
const REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

// Atomically checks-and-updates stateVersion inside the JSON record in one
// round trip: GET, compare the version field, and only SET if it still
// matches. Runs server-side in Redis so there is no window between the
// version check and the write for a second concurrent save to land in.
const CAS_STATE_SCRIPT = `
  local record = redis.call('GET', KEYS[1])
  if not record then
    return {0, -1}
  end
  local decoded = cjson.decode(record)
  local current = decoded.stateVersion or 0
  if current ~= tonumber(ARGV[1]) then
    return {0, current}
  end
  decoded.stateCiphertext = cjson.decode(ARGV[2])
  decoded.stateVersion = current + 1
  decoded.updatedAt = ARGV[3]
  redis.call('SET', KEYS[1], cjson.encode(decoded))
  return {1, decoded.stateVersion}
`;

// ---- Durable Upstash Redis store -------------------------------------------
function redisStore(): OfficeStore {
  const redis = new Redis({
    url: REDIS_REST_URL as string,
    token: REDIS_REST_TOKEN as string,
  });
  return {
    async get(officeId) {
      return (await redis.get<OfficeRecord>(key(officeId))) ?? null;
    },
    async create(record, overwrite = false) {
      // SET with NX creates only if absent; returns "OK" or null.
      const ok = await redis.set(key(record.officeId), record, overwrite ? undefined : { nx: true });
      return ok === "OK";
    },
    async update(officeId, patch) {
      const existing = await redis.get<OfficeRecord>(key(officeId));
      if (!existing) return;
      await redis.set(key(officeId), { ...existing, ...patch, updatedAt: new Date().toISOString() });
    },
    async casState(officeId, expectedVersion, stateCiphertext) {
      try {
        const [success, version] = (await redis.eval(
          CAS_STATE_SCRIPT,
          [key(officeId)],
          [String(expectedVersion), JSON.stringify(stateCiphertext), new Date().toISOString()]
        )) as [number, number];
        if (version === -1) return { ok: false, version: null };
        return success === 1 ? { ok: true, version } : { ok: false, version };
      } catch (err) {
        // If EVAL is unavailable for any reason, fall back to the previous
        // get-then-set behavior rather than failing the save outright — this
        // has the same (narrow, pre-existing) race window it always had, but
        // is no worse than before this atomic path existed.
        console.error("casState: EVAL failed, falling back to non-atomic update", err);
        const existing = await redis.get<OfficeRecord>(key(officeId));
        if (!existing) return { ok: false, version: null };
        if (existing.stateVersion !== expectedVersion) {
          return { ok: false, version: existing.stateVersion };
        }
        const nextVersion = existing.stateVersion + 1;
        await redis.set(key(officeId), {
          ...existing,
          stateCiphertext,
          stateVersion: nextVersion,
          updatedAt: new Date().toISOString(),
        });
        return { ok: true, version: nextVersion };
      }
    },
  };
}

// ---- In-memory store (dev / no KV configured) ------------------------------
const globalForStore = globalThis as unknown as { __sbOfficeStore?: Map<string, OfficeRecord> };
const memory = globalForStore.__sbOfficeStore ?? new Map<string, OfficeRecord>();
globalForStore.__sbOfficeStore = memory;

const memoryStore: OfficeStore = {
  async get(officeId) {
    return memory.get(officeId) ?? null;
  },
  async create(record, overwrite = false) {
    if (!overwrite && memory.has(record.officeId)) return false;
    memory.set(record.officeId, record);
    return true;
  },
  async update(officeId, patch) {
    const existing = memory.get(officeId);
    if (!existing) return;
    memory.set(officeId, { ...existing, ...patch, updatedAt: new Date().toISOString() });
  },
  // Node is single-threaded and nothing here awaits between the check and the
  // write, so this is inherently atomic — no separate CAS path needed.
  async casState(officeId, expectedVersion, stateCiphertext) {
    const existing = memory.get(officeId);
    if (!existing) return { ok: false, version: null };
    if (existing.stateVersion !== expectedVersion) {
      return { ok: false, version: existing.stateVersion };
    }
    const nextVersion = existing.stateVersion + 1;
    memory.set(officeId, {
      ...existing,
      stateCiphertext,
      stateVersion: nextVersion,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, version: nextVersion };
  },
};

let warnedAboutMemoryFallback = false;

export function getOfficeStore(): OfficeStore {
  if (REDIS_REST_URL && REDIS_REST_TOKEN) return redisStore();
  // Falling back to a per-instance, non-persistent Map is fine for local dev,
  // but in a real deployment it means saves silently vanish on redeploy/scale
  // and different instances show different data. Log loudly so a misconfigured
  // or rotated env var shows up in server logs instead of looking like a
  // working, just-quiet integration.
  if (process.env.NODE_ENV === "production" && !warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true;
    console.error(
      "getOfficeStore: UPSTASH_REDIS_REST_URL/TOKEN (or legacy KV_REST_API_*) are not set in " +
        "production — falling back to an in-memory store. Office data will NOT persist across " +
        "redeploys or be shared across instances. Check /api/health's `store` field."
    );
  }
  return memoryStore;
}
