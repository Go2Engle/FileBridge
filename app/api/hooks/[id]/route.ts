import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { getHook, updateHook, deleteHook, getJobsUsingHook } from "@/lib/db/hooks";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
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
  const hook = getHook(Number(id));
  if (!hook) return NextResponse.json({ error: "Hook not found" }, { status: 404 });

  return NextResponse.json(hook);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  const hook = getHook(Number(id));
  if (!hook) return NextResponse.json({ error: "Hook not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { name, description, type, config, enabled } = body;

    if (name !== undefined && (!name || typeof name !== "string" || !name.trim())) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (type !== undefined && type !== "webhook" && type !== "shell") {
      return NextResponse.json({ error: "Type must be 'webhook' or 'shell'" }, { status: 400 });
    }
    if (config !== undefined) {
      if (typeof config !== "object") {
        return NextResponse.json({ error: "Config must be an object" }, { status: 400 });
      }
      const resolvedType = type ?? hook.type;
      if (resolvedType === "webhook" && (!config.url || typeof config.url !== "string")) {
        return NextResponse.json({ error: "Webhook URL is required" }, { status: 400 });
      }
      if (resolvedType === "shell" && (!config.command || typeof config.command !== "string" || !config.command.trim())) {
        return NextResponse.json({ error: "Shell command is required" }, { status: 400 });
      }
    }

    const updated = updateHook(Number(id), {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(config !== undefined ? { config: JSON.stringify(config) } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    });

    logAudit({
      userId: getUserId(session),
      action: "update",
      resource: "settings",
      resourceId: Number(id),
      resourceName: updated?.name ?? hook.name,
      ipAddress: getIpFromRequest(req),
      details: { type: updated?.type },
    });

    return NextResponse.json(updated);
  } catch (error) {
    log.error("PUT /hooks/[id] failed", { error });
    return NextResponse.json({ error: "Failed to update hook" }, { status: 500 });
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
  const hook = getHook(Number(id));
  if (!hook) return NextResponse.json({ error: "Hook not found" }, { status: 404 });

  // Block deletion if the hook is still attached to jobs
  const jobIds = getJobsUsingHook(Number(id));
  if (jobIds.length > 0) {
    const jobRows = db.select({ id: jobs.id, name: jobs.name })
      .from(jobs)
      .where(inArray(jobs.id, jobIds))
      .all();
    return NextResponse.json(
      { error: "Hook is in use", jobs: jobRows },
      { status: 409 }
    );
  }

  try {
    deleteHook(Number(id));

    logAudit({
      userId: getUserId(session),
      action: "delete",
      resource: "settings",
      resourceId: Number(id),
      resourceName: hook.name,
      ipAddress: getIpFromRequest(req),
      details: { type: hook.type },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    log.error("DELETE /hooks/[id] failed", { error });
    return NextResponse.json({ error: "Failed to delete hook" }, { status: 500 });
  }
}
