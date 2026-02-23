import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { transferLogs, jobRuns } from "@/lib/db/schema";
import { lt, sql, and, ne } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

/** GET /api/logs/purge?cutoffDate=<ISO> — preview counts */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const cutoffDate = new URL(req.url).searchParams.get("cutoffDate");
  if (!cutoffDate || isNaN(Date.parse(cutoffDate)))
    return NextResponse.json({ error: "Invalid cutoff date" }, { status: 400 });

  try {
    const [{ logsCount }] = await db
      .select({ logsCount: sql<number>`count(*)` })
      .from(transferLogs)
      .where(lt(transferLogs.transferredAt, cutoffDate));

    const [{ runsCount }] = await db
      .select({ runsCount: sql<number>`count(*)` })
      .from(jobRuns)
      .where(
        and(
          lt(jobRuns.startedAt, cutoffDate),
          ne(jobRuns.status, "running"),
          sql`NOT EXISTS (SELECT 1 FROM transfer_logs WHERE transfer_logs.job_run_id = ${jobRuns.id})`
        )
      );

    return NextResponse.json({
      logsCount: Number(logsCount),
      runsCount: Number(runsCount),
    });
  } catch (error) {
    log.error("GET /logs/purge failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json(
      { error: "Failed to count records" },
      { status: 500 }
    );
  }
}

/** POST /api/logs/purge { cutoffDate } — execute purge */
export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  try {
    const { cutoffDate } = await req.json();
    if (!cutoffDate || isNaN(Date.parse(cutoffDate)))
      return NextResponse.json(
        { error: "Invalid cutoff date" },
        { status: 400 }
      );

    // Delete transfer_logs first (child table) to satisfy FK constraints
    const logsResult = await db
      .delete(transferLogs)
      .where(lt(transferLogs.transferredAt, cutoffDate));

    // Delete job_runs (parent) only when all their transfer_logs are gone
    const runsResult = await db.run(sql`
      DELETE FROM job_runs
      WHERE started_at < ${cutoffDate}
        AND status != 'running'
        AND NOT EXISTS (
          SELECT 1 FROM transfer_logs WHERE transfer_logs.job_run_id = job_runs.id
        )
    `);

    return NextResponse.json({
      success: true,
      deletedLogs: logsResult.changes ?? 0,
      deletedRuns: runsResult.changes ?? 0,
    });
  } catch (error) {
    log.error("POST /logs/purge failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json(
      { error: "Failed to purge logs" },
      { status: 500 }
    );
  }
}
