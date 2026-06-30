import type { EncryptedEnvelope, SealedBlob } from "@slatebuilder/core";

// Per-office server record. Holds only auth material, the wrapped office key
// (opaque ciphertext), and the end-to-end-encrypted working blob. The server
// never sees the office key, patient tokens, names, PHNs, or diagnoses.
export type OfficeRecord = {
  officeId: string;
  pwHash: string; // scrypt "salt:hash"
  wrappedOfficeKey: EncryptedEnvelope;
  kdfNote?: string;
  stateCiphertext: SealedBlob | null;
  stateVersion: number;
  updatedAt: string;
};

export interface OfficeStore {
  get(officeId: string): Promise<OfficeRecord | null>;
  create(record: OfficeRecord): Promise<boolean>; // false if the office already exists
  update(officeId: string, patch: Partial<OfficeRecord>): Promise<void>;
}

// In-memory store. Survives dev hot-reloads via globalThis, and is sufficient
// for local end-to-end testing (single dev-server process). For production,
// implement OfficeStore over a durable KV/DB (e.g. Vercel KV / Upstash) and
// select it here based on env.
const globalForStore = globalThis as unknown as { __sbOfficeStore?: Map<string, OfficeRecord> };
const memory = globalForStore.__sbOfficeStore ?? new Map<string, OfficeRecord>();
globalForStore.__sbOfficeStore = memory;

const memoryStore: OfficeStore = {
  async get(officeId) {
    return memory.get(officeId) ?? null;
  },
  async create(record) {
    if (memory.has(record.officeId)) return false;
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
  // Hook for a durable backend: `if (process.env.KV_REST_API_URL) return kvStore;`
  return memoryStore;
}
