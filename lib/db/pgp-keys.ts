import { db } from "@/lib/db";
import { pgpKeys, jobs } from "@/lib/db/schema";
import type { PgpKey, NewPgpKey } from "@/lib/db/schema";
import { eq, or, desc } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto";

// ── Encryption helpers for private key & passphrase ──────────────

function encryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  return encrypt(value);
}

function decryptField(value: string | null): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return value; // Legacy fallback
  }
}

function decryptSensitive(row: PgpKey): PgpKey {
  return {
    ...row,
    privateKey: decryptField(row.privateKey),
    passphrase: decryptField(row.passphrase),
  };
}

function stripSensitive(
  row: PgpKey
): Omit<PgpKey, "privateKey" | "passphrase"> {
  const { privateKey: _pk, passphrase: _pp, ...rest } = row;
  return rest;
}

// ── CRUD ──────────────────────────────────────────────────────────

/** Return all keys with private material stripped (safe for list endpoints). */
export function getAllPgpKeys(): Omit<PgpKey, "privateKey" | "passphrase">[] {
  const rows = db
    .select()
    .from(pgpKeys)
    .orderBy(desc(pgpKeys.createdAt))
    .all();
  return rows.map(stripSensitive);
}

/** Return a single key with decrypted private material (for engine use). */
export function getPgpKey(id: number): PgpKey | undefined {
  const row = db.select().from(pgpKeys).where(eq(pgpKeys.id, id)).get();
  return row ? decryptSensitive(row) : undefined;
}

/** Return a key with private material stripped (for API responses). */
export function getPgpKeyPublic(
  id: number
): Omit<PgpKey, "privateKey" | "passphrase"> | undefined {
  const row = db.select().from(pgpKeys).where(eq(pgpKeys.id, id)).get();
  return row ? stripSensitive(row) : undefined;
}

export function createPgpKey(data: NewPgpKey): PgpKey {
  const [row] = db
    .insert(pgpKeys)
    .values({
      ...data,
      privateKey: encryptField(data.privateKey),
      passphrase: encryptField(data.passphrase),
    })
    .returning()
    .all();
  return decryptSensitive(row);
}

export function updatePgpKey(
  id: number,
  data: Partial<NewPgpKey>
): PgpKey | undefined {
  const update: Record<string, unknown> = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  if (data.privateKey !== undefined) {
    update.privateKey = encryptField(data.privateKey);
  }
  if (data.passphrase !== undefined) {
    update.passphrase = encryptField(data.passphrase);
  }
  const [row] = db
    .update(pgpKeys)
    .set(update)
    .where(eq(pgpKeys.id, id))
    .returning()
    .all();
  return row ? decryptSensitive(row) : undefined;
}

export function deletePgpKey(id: number): void {
  db.delete(pgpKeys).where(eq(pgpKeys.id, id)).run();
}

/** Returns job IDs that reference a given PGP key (for dependency check before delete). */
export function getJobsUsingPgpKey(keyId: number): number[] {
  const rows = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      or(
        eq(jobs.pgpEncryptKeyId, keyId),
        eq(jobs.pgpDecryptKeyId, keyId)
      )
    )
    .all();
  return rows.map((r) => r.id);
}
