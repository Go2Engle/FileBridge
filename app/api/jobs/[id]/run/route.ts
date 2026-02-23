import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { runJob } from "@/lib/transfer/engine";
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
    log.error("Manual job run failed", { jobId, requestId: req.headers.get("x-request-id") ?? undefined, error: err })
  );

  return NextResponse.json({ message: "Job triggered" });
}
