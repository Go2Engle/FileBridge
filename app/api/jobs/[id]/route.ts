import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobs, jobRuns, transferLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { scheduleJob, unscheduleJob } from "@/lib/scheduler";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await db.query.jobs.findFirst({ where: eq(jobs.id, Number(id)) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    return NextResponse.json(row);
  } catch (error) {
    console.error("[API] PUT /jobs/[id]:", error);
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const body = await req.json();
    const { status } = body;

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

    return NextResponse.json(row);
  } catch (error) {
    console.error("[API] PATCH /jobs/[id]:", error);
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const jobId = Number(id);
  try {
    unscheduleJob(jobId);
    // Delete children before the parent to satisfy FK constraints
    await db.delete(transferLogs).where(eq(transferLogs.jobId, jobId));
    await db.delete(jobRuns).where(eq(jobRuns.jobId, jobId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[API] DELETE /jobs/[id]:", error);
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
  }
}
