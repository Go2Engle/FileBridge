import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { transferLogs } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
