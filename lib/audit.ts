import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import type { NewAuditLog } from "@/lib/db/schema";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";

type AuditAction = NewAuditLog["action"];
type AuditResource = NewAuditLog["resource"];

interface LogAuditOptions {
  userId: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: number | null;
  resourceName?: string | null;
  ipAddress?: string | null;
  details?: Record<string, unknown> | null;
}

/** Extract the best available IP from a Next.js request. */
export function getIpFromRequest(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

/** Extract userId (email) from a NextAuth session. */
export function getUserId(session: Session): string {
  return session.user?.email ?? session.user?.name ?? "unknown";
}

/**
 * Compare two objects and return only the fields that changed,
 * in the form { fieldName: { from: oldValue, to: newValue } }.
 * Fields listed in `skip` are excluded (e.g. credentials, timestamps).
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skip: string[] = []
): Record<string, { from: unknown; to: unknown }> {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (skip.includes(key)) continue;
    const bv = before[key];
    const av = after[key];
    // Loose equality check covers null vs undefined and number coercion
    if (String(bv) !== String(av)) {
      changed[key] = { from: bv, to: av };
    }
  }
  return changed;
}

/**
 * Write a single audit log entry. Fire-and-forget — errors are caught and
 * logged to stderr so they never interrupt the calling request.
 */
export async function logAudit(opts: LogAuditOptions): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: opts.userId,
      action: opts.action,
      resource: opts.resource,
      resourceId: opts.resourceId ?? null,
      resourceName: opts.resourceName ?? null,
      ipAddress: opts.ipAddress ?? null,
      details: opts.details ?? null,
    });
  } catch (err) {
    console.error("[Audit] Failed to write audit log:", err);
  }
}
