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

export interface OfficeStore {
  get(officeId: string): Promise<OfficeRecord | null>;
  create(record: OfficeRecord, overwrite?: boolean): Promise<boolean>; // false if it exists and overwrite is false
  update(officeId: string, patch: Partial<OfficeRecord>): Promise<void>;
}

const key = (officeId: string) => `office:${officeId}`;

// Accept either the Upstash-native names or the legacy KV_REST_API_* names that
// the Vercel Marketplace Upstash integration provisions.
const REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

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
};

export function getOfficeStore(): OfficeStore {
  return REDIS_REST_URL && REDIS_REST_TOKEN ? redisStore() : memoryStore;
}
