import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runJob } from "@/lib/transfer/engine";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const jobId = Number(id);

  // Fetch job name for the audit record
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });

  logAudit({
    userId: getUserId(session),
    action: "execute",
    resource: "job",
    resourceId: jobId,
    resourceName: job?.name ?? null,
    ipAddress: getIpFromRequest(req),
    details: { trigger: "manual" },
  });

  // Run asynchronously — don't block the response
  runJob(jobId).catch((err) =>
    console.error(`[API] Manual run of job ${jobId} failed:`, err)
  );

  return NextResponse.json({ message: "Job triggered" });
}
