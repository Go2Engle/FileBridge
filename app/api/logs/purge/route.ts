import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { transferLogs, jobRuns } from "@/lib/db/schema";
import { lt, sql, and, ne } from "drizzle-orm";

/** GET /api/logs/purge?cutoffDate=<ISO> — preview counts */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    console.error("[API] GET /logs/purge:", error);
    return NextResponse.json(
      { error: "Failed to count records" },
      { status: 500 }
    );
  }
}

/** POST /api/logs/purge { cutoffDate } — execute purge */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    console.error("[API] POST /logs/purge:", error);
    return NextResponse.json(
      { error: "Failed to purge logs" },
      { status: 500 }
    );
  }
}
