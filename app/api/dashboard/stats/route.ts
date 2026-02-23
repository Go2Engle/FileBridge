import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { jobRuns, transferLogs, jobs } from "@/lib/db/schema";
import { eq, gte, sql, and } from "drizzle-orm";
import { subDays, format, startOfDay } from "date-fns";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET(req: NextRequest) {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  const { searchParams } = new URL(req.url);
  const isChart = searchParams.get("chart") === "true";

  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const last7d = subDays(now, 7).toISOString();

    if (isChart) {
      // Build chart data for last 7 days
      const chartData = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = startOfDay(subDays(now, i)).toISOString();
        const dayEnd = startOfDay(subDays(now, i - 1)).toISOString();

        const [{ count, bytes }] = await db
          .select({
            count: sql<number>`count(*)`,
            bytes: sql<number>`coalesce(sum(${transferLogs.fileSize}), 0)`,
          })
          .from(transferLogs)
          .where(
            and(
              gte(transferLogs.transferredAt, dayStart),
              sql`${transferLogs.transferredAt} < ${dayEnd}`,
              eq(transferLogs.status, "success")
            )
          );

        chartData.push({
          date: format(subDays(now, i), "MMM d"),
          files: Number(count),
          bytes: Number(bytes),
        });
      }
      return NextResponse.json(chartData);
    }

    // KPI stats
    const [files24h] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transferLogs)
      .where(
        and(
          gte(transferLogs.transferredAt, last24h),
          eq(transferLogs.status, "success")
        )
      );

    const [files7d] = await db
      .select({
        count: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(${transferLogs.fileSize}), 0)`,
      })
      .from(transferLogs)
      .where(
        and(
          gte(transferLogs.transferredAt, last7d),
          eq(transferLogs.status, "success")
        )
      );

    const [allTime] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transferLogs)
      .where(eq(transferLogs.status, "success"));

    // Success rate for last 7 days
    const [successRate7d] = await db
      .select({
        success: sql<number>`sum(case when status = 'success' then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(jobRuns)
      .where(gte(jobRuns.startedAt, last7d));

    const successRate =
      Number(successRate7d.total) > 0
        ? (Number(successRate7d.success) / Number(successRate7d.total)) * 100
        : 100;

    const [activeJobCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(eq(jobs.status, "active"));

    return NextResponse.json({
      filesLast24h: Number(files24h.count),
      filesLast7d: Number(files7d.count),
      filesAllTime: Number(allTime.count),
      bytesLast7d: Number(files7d.bytes),
      successRate,
      activeJobs: Number(activeJobCount.count),
    });
  } catch (error) {
    log.error("GET /dashboard/stats failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
