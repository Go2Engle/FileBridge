import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { transferLogs, jobs } from "@/lib/db/schema";
import { eq, desc, like, and, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? "25");
  const offset = Number(searchParams.get("offset") ?? "0");
  const search = searchParams.get("search");
  const status = searchParams.get("status") as "success" | "failure" | null;
  const jobId = searchParams.get("jobId");

  try {
    const conditions = [];
    if (search) conditions.push(like(transferLogs.fileName, `%${search}%`));
    if (status) conditions.push(eq(transferLogs.status, status));
    if (jobId) conditions.push(eq(transferLogs.jobId, Number(jobId)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db
        .select({
          id: transferLogs.id,
          jobId: transferLogs.jobId,
          jobRunId: transferLogs.jobRunId,
          fileName: transferLogs.fileName,
          sourcePath: transferLogs.sourcePath,
          destinationPath: transferLogs.destinationPath,
          fileSize: transferLogs.fileSize,
          transferredAt: transferLogs.transferredAt,
          status: transferLogs.status,
          errorMessage: transferLogs.errorMessage,
          jobName: jobs.name,
        })
        .from(transferLogs)
        .leftJoin(jobs, eq(transferLogs.jobId, jobs.id))
        .where(where)
        .orderBy(desc(transferLogs.transferredAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(transferLogs)
        .where(where),
    ]);

    return NextResponse.json({ logs: rows, total: Number(count) });
  } catch (error) {
    console.error("[API] GET /logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
