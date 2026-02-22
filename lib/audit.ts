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
