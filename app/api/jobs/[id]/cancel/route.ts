import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { jobRuns, jobs } from "@/lib/db/schema";
import { cancelActiveJob, detachActiveJob } from "@/lib/transfer/cancellation";
import { getIpFromRequest, getUserId, logAudit } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");
const STOPPED_MESSAGE = "Job stopped by an administrator";

/**
 * How long to wait for the engine to unwind gracefully (close streams and
 * provider connections, record the failed run) before force-resetting the job.
 * Kept short enough that the HTTP request does not time out in a browser.
 */
export const CANCEL_GRACE_MS = 15_000;

type Recovery = "cancelled" | "forced" | "stale_reset";

async function forceResetJob(jobId: number, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(jobRuns)
    .set({
      status: "failure",
      completedAt: now,
      errorMessage: `${STOPPED_MESSAGE} (${reason})`,
      currentFile: null,
      currentFileSize: null,
      currentFileBytesTransferred: null,
    })
    .where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "running")));
  await db
    .update(jobs)
    .set({ status: "active", lastRunAt: now, updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")));
}

function waitFor(completion: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    completion.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

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

  log.warn("Job stop requested", { jobId });
  const completion = cancelActiveJob(jobId);
  let recovery: Recovery;

  if (completion) {
    // Give the engine a chance to unwind on its own: it closes provider
    // connections, removes partial files and records the failed run.
    const stoppedCleanly = await waitFor(completion, CANCEL_GRACE_MS);
    if (stoppedCleanly) {
      recovery = "cancelled";
    } else {
      // The engine is wedged in an operation that is not observing the abort
      // signal. Don't leave the job stuck in "running" — release it now. The
      // signal stays aborted, so the hung task fails on its next check.
      log.error("Job did not stop within grace period — forcing reset", {
        jobId,
        graceMs: CANCEL_GRACE_MS,
      });
      await forceResetJob(jobId, "forced after engine did not respond");
      detachActiveJob(jobId);
      recovery = "forced";
    }
  } else {
    // A running DB row with no in-process execution handle is stale (for
    // example after a service restart or interrupted hot reload).
    await forceResetJob(jobId, "stale execution recovered");
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

  log.warn("Job stop completed", { jobId, recovery });
  const message =
    recovery === "cancelled"
      ? "Job stopped"
      : recovery === "forced"
        ? "Job force-stopped (engine did not respond in time)"
        : "Stale job recovered";
  return NextResponse.json({ message, recovery }, { status: 200 });
}
