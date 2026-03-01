import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { getJobHooksWithDetail, setJobHooks } from "@/lib/db/hooks";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { id } = await params;

  const pre = getJobHooksWithDetail(Number(id), "pre_job");
  const post = getJobHooksWithDetail(Number(id), "post_job");

  return NextResponse.json({ pre, post });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;

  const job = db.select().from(jobs).where(eq(jobs.id, Number(id))).get();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { pre, post } = body as { pre?: number[]; post?: number[] };

    if (pre !== undefined) {
      if (!Array.isArray(pre) || pre.some((v) => typeof v !== "number")) {
        return NextResponse.json({ error: "'pre' must be an array of hook IDs" }, { status: 400 });
      }
      setJobHooks(Number(id), "pre_job", pre);
    }
    if (post !== undefined) {
      if (!Array.isArray(post) || post.some((v) => typeof v !== "number")) {
        return NextResponse.json({ error: "'post' must be an array of hook IDs" }, { status: 400 });
      }
      setJobHooks(Number(id), "post_job", post);
    }

    logAudit({
      userId: getUserId(session),
      action: "update",
      resource: "job",
      resourceId: Number(id),
      resourceName: job.name,
      ipAddress: getIpFromRequest(req),
      details: { preHooks: pre, postHooks: post },
    });

    const updatedPre = getJobHooksWithDetail(Number(id), "pre_job");
    const updatedPost = getJobHooksWithDetail(Number(id), "post_job");

    return NextResponse.json({ pre: updatedPre, post: updatedPost });
  } catch (error) {
    log.error("PUT /jobs/[id]/hooks failed", { error });
    return NextResponse.json({ error: "Failed to update job hooks" }, { status: 500 });
  }
}
