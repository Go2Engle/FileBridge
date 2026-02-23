import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  const { id } = await params;

  const rows = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.jobId, Number(id)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(10);

  return NextResponse.json(rows);
}
