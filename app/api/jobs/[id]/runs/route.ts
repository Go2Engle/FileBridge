import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const rows = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.jobId, Number(id)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(10);

  return NextResponse.json(rows);
}
