import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { stopJob } from "@/lib/transfer/engine";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  const jobId = Number(id);

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.status !== "running") {
    return NextResponse.json({ error: "Job is not running" }, { status: 400 });
  }

  const stopped = stopJob(jobId);

  logAudit({
    userId: getUserId(session),
    action: "execute",
    resource: "job",
    resourceId: jobId,
    resourceName: job.name,
    ipAddress: getIpFromRequest(req),
    details: { trigger: "stop", success: stopped },
  });

  if (!stopped) {
    log.warn("Stop requested but no active controller found", { jobId });
    return NextResponse.json({ message: "Stop signal sent (job may have already completed)" });
  }

  return NextResponse.json({ message: "Stop signal sent" });
}
