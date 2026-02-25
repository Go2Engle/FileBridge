import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";
import { CronExpressionParser } from "cron-parser";
import { getSchedulerTimezone } from "@/lib/scheduler";

const log = createLogger("api");

function computeNextRunAt(schedule: string, timezone: string): string | null {
  try {
    const expr = CronExpressionParser.parse(schedule, { tz: timezone });
    return expr.next().toDate().toISOString();
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt));
  const timezone = await getSchedulerTimezone();

  const enriched = rows.map((row) => ({
    ...row,
    nextRunAt:
      row.status === "active" || row.status === "running"
        ? computeNextRunAt(row.schedule, timezone)
        : null,
  }));

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

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
