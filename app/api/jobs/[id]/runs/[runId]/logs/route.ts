import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { transferLogs, hookRuns } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  const { id, runId } = await params;

  const [transfers, hooks] = await Promise.all([
    db
      .select()
      .from(transferLogs)
      .where(
        and(
          eq(transferLogs.jobId, Number(id)),
          eq(transferLogs.jobRunId, Number(runId))
        )
      )
      .orderBy(asc(transferLogs.transferredAt)),

    db
      .select()
      .from(hookRuns)
      .where(
        and(
          eq(hookRuns.jobId, Number(id)),
          eq(hookRuns.jobRunId, Number(runId))
        )
      )
      .orderBy(asc(hookRuns.executedAt)),
  ]);

  // Merge and sort by timestamp, adding a type discriminator
  const merged = [
    ...transfers.map((t) => ({ ...t, logType: "transfer" as const })),
    ...hooks.map((h) => ({ ...h, logType: "hook" as const })),
  ].sort((a, b) => {
    const aTime = "transferredAt" in a ? a.transferredAt : a.executedAt;
    const bTime = "transferredAt" in b ? b.transferredAt : b.executedAt;
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });

  return NextResponse.json(merged);
}
