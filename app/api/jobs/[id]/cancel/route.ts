import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { jobRuns, jobs } from "@/lib/db/schema";
import { cancelActiveJob } from "@/lib/transfer/cancellation";
import { getIpFromRequest, getUserId, logAudit } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");
const STOPPED_MESSAGE = "Job stopped by an administrator";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "running") {
    return NextResponse.json({ error: "Job is not running" }, { status: 409 });
  }

  const completion = cancelActiveJob(jobId);
  let recovery: "cancelled" | "stale_reset";

  if (completion) {
    // The engine owns final status/run-history cleanup. Do not flip the job to
    // runnable until its provider connections and streams have been closed.
    recovery = "cancelled";
  } else {
    // A running DB row with no in-process execution handle is stale (for
    // example after an interrupted hot reload). It is safe to recover it here.
    const now = new Date().toISOString();
    await db
      .update(jobRuns)
      .set({
        status: "failure",
        completedAt: now,
        errorMessage: `${STOPPED_MESSAGE} (stale execution recovered)`,
        currentFile: null,
        currentFileSize: null,
        currentFileBytesTransferred: null,
      })
      .where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "running")));
    await db
      .update(jobs)
      .set({ status: "active", lastRunAt: now, updatedAt: now })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")));
    recovery = "stale_reset";
  }

  logAudit({
    userId: getUserId(result.session),
    action: "execute",
    resource: "job",
    resourceId: jobId,
    resourceName: job.name,
    ipAddress: getIpFromRequest(req),
    details: { trigger: "manual_stop", recovery },
  });

  log.warn("Job stop requested", { jobId, recovery });
  return NextResponse.json(
    {
      message: recovery === "cancelled" ? "Job stop requested" : "Stale job recovered",
      recovery,
    },
    { status: recovery === "cancelled" ? 202 : 200 },
  );
}
