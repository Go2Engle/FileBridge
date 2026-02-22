import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    } = body;

    const [row] = await db
      .insert(jobs)
      .values({
        name,
        sourceConnectionId: Number(sourceConnectionId),
        sourcePath,
        destinationConnectionId: Number(destinationConnectionId),
        destinationPath,
        fileFilter: fileFilter ?? "",
        schedule,
        postTransferAction: postTransferAction || "retain",
        movePath: movePath || null,
        overwriteExisting: overwriteExisting ?? false,
        skipHiddenFiles: skipHiddenFiles ?? true,
        extractArchives: extractArchives ?? false,
        deltaSync: deltaSync ?? false,
        status: "inactive",
      })
      .returning();

    logAudit({
      userId: getUserId(session),
      action: "create",
      resource: "job",
      resourceId: row.id,
      resourceName: row.name,
      ipAddress: getIpFromRequest(req),
      details: { schedule: row.schedule, postTransferAction: row.postTransferAction },
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    log.error("POST /jobs failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}
