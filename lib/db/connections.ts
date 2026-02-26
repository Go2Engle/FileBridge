/**
 * Helpers for reading and writing connection records with AES-256-GCM
 * field-level encryption on the credentials column.
 *
 * All code that reads or writes connection credentials must go through
 * these helpers — never access `connections.credentials` from Drizzle
 * directly, because the raw value is an opaque encrypted string.
 */

import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto";
import type { Connection } from "@/lib/db/schema";

/** A connection row with credentials already decrypted to a plain object. */
export type DecryptedConnection = Omit<Connection, "credentials"> & {
  credentials: Record<string, string>;
};

/** Serialize and encrypt credentials for storage. */
export function encryptCreds(creds: Record<string, string>): string {
  return encrypt(JSON.stringify(creds));
}

/**
 * Decrypt stored credentials back to a plain object.
 * Falls back to JSON.parse for legacy rows that were never migrated
 * (e.g. a backup restored before the migration ran).
 */
export function decryptCreds(stored: string): Record<string, string> {
  try {
    return JSON.parse(decrypt(stored));
  } catch {
    // Legacy: might be a plain JSON string written before encryption was added.
    try {
      return JSON.parse(stored);
    } catch {
      return {};
    }
  }
}

/** Fetch a single connection with decrypted credentials. Returns undefined if not found. */
export function getConnection(id: number): DecryptedConnection | undefined {
  const row = db
    .select()
    .from(connections)
    .where(eq(connections.id, id))
    .get();
  if (!row) return undefined;
  return { ...row, credentials: decryptCreds(row.credentials) };
}

/** Fetch all connections ordered by creation date (newest first), with decrypted credentials. */
export function getAllConnections(): DecryptedConnection[] {
  return db
    .select()
    .from(connections)
    .orderBy(desc(connections.createdAt))
    .all()
    .map((row) => ({ ...row, credentials: decryptCreds(row.credentials) }));
}
