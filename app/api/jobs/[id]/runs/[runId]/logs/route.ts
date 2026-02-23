import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { transferLogs } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  const { id, runId } = await params;

  const rows = await db
    .select()
    .from(transferLogs)
    .where(
      and(
        eq(transferLogs.jobId, Number(id)),
        eq(transferLogs.jobRunId, Number(runId))
      )
    )
    .orderBy(asc(transferLogs.transferredAt));

  return NextResponse.json(rows);
}
