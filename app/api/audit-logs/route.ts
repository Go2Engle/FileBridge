import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { desc, like, eq, and, sql } from "drizzle-orm";
import type { AuditLog } from "@/lib/db/schema";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const offset = Number(searchParams.get("offset") ?? "0");
  const limit = Math.min(Number(searchParams.get("limit") ?? String(PAGE_SIZE)), 200);
  const userFilter = searchParams.get("userId");
  const actionFilter = searchParams.get("action") as AuditLog["action"] | null;
  const resourceFilter = searchParams.get("resource") as AuditLog["resource"] | null;

  try {
    const conditions = [];
    if (userFilter) conditions.push(like(auditLogs.userId, `%${userFilter}%`));
    if (actionFilter) conditions.push(eq(auditLogs.action, actionFilter));
    if (resourceFilter) conditions.push(eq(auditLogs.resource, resourceFilter));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(where),
    ]);

    return NextResponse.json({ logs: rows, total: Number(count) });
  } catch (error) {
    log.error("GET /audit-logs failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
  }
}
