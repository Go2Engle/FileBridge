import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { jobs, jobRuns, transferLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { scheduleJob, unscheduleJob } from "@/lib/scheduler";
import { logAudit, getUserId, getIpFromRequest, diffChanges } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const row = await db.query.jobs.findFirst({ where: eq(jobs.id, Number(id)) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  try {
    const body = await req.json();
    const {
      name,
      sourceConnectionId,
      sourcePath,
      destinationConnectionId,
      destinationPath,
      fileFilter,
      schedule,
      postTransferAction,
      movePath,
      overwriteExisting,
      skipHiddenFiles,
      extractArchives,
      deltaSync,
      status,
    } = body;

    // Snapshot current state before update for diffing
    const before = await db.query.jobs.findFirst({ where: eq(jobs.id, Number(id)) });

    const [row] = await db
      .update(jobs)
      .set({
        name,
        sourceConnectionId: Number(sourceConnectionId),
        sourcePath,
        destinationConnectionId: Number(destinationConnectionId),
        destinationPath,
        fileFilter,
        schedule,
        postTransferAction,
        movePath: movePath || null,
        overwriteExisting: overwriteExisting ?? false,
        skipHiddenFiles: skipHiddenFiles ?? true,
        extractArchives: extractArchives ?? false,
        deltaSync: deltaSync ?? false,
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(jobs.id, Number(id)))
      .returning();

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Update scheduler
    if (row.status === "active") {
      scheduleJob(row.id, row.schedule);
    } else {
      unscheduleJob(row.id);
    }

    const changes = before
      ? diffChanges(
          before as unknown as Record<string, unknown>,
          row as unknown as Record<string, unknown>,
          ["id", "createdAt", "updatedAt", "lastRunAt", "nextRunAt"]
        )
      : {};

    logAudit({
      userId: getUserId(session),
      action: "update",
      resource: "job",
      resourceId: row.id,
      resourceName: row.name,
      ipAddress: getIpFromRequest(req),
      details: Object.keys(changes).length > 0 ? changes : null,
    });

    return NextResponse.json(row);
  } catch (error) {
    log.error("PUT /jobs/[id] failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  try {
    const body = await req.json();
    const { status } = body;

    const before = await db.query.jobs.findFirst({ where: eq(jobs.id, Number(id)) });

    const [row] = await db
      .update(jobs)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, Number(id)))
      .returning();

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (row.status === "active") {
      scheduleJob(row.id, row.schedule);
    } else {
      unscheduleJob(row.id);
    }

    logAudit({
      userId: getUserId(session),
      action: "update",
      resource: "job",
      resourceId: row.id,
      resourceName: row.name,
      ipAddress: getIpFromRequest(req),
      details: before ? { status: { from: before.status, to: row.status } } : { status: { to: row.status } },
    });

    return NextResponse.json(row);
  } catch (error) {
    log.error("PATCH /jobs/[id] failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  const jobId = Number(id);
  try {
    // Fetch name before deletion for audit record
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });

    unscheduleJob(jobId);
    // Delete children before the parent to satisfy FK constraints
    await db.delete(transferLogs).where(eq(transferLogs.jobId, jobId));
    await db.delete(jobRuns).where(eq(jobRuns.jobId, jobId));
    await db.delete(jobs).where(eq(jobs.id, jobId));

    logAudit({
      userId: getUserId(session),
      action: "delete",
      resource: "job",
      resourceId: jobId,
      resourceName: job?.name ?? null,
      ipAddress: getIpFromRequest(req),
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    log.error("DELETE /jobs/[id] failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
  }
}
