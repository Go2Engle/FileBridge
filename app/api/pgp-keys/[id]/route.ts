import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import {
  getPgpKeyPublic,
  updatePgpKey,
  deletePgpKey,
  getJobsUsingPgpKey,
} from "@/lib/db/pgp-keys";
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
  const key = getPgpKeyPublic(Number(id));
  if (!key)
    return NextResponse.json({ error: "PGP key not found" }, { status: 404 });

  return NextResponse.json(key);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  const existing = getPgpKeyPublic(Number(id));
  if (!existing)
    return NextResponse.json({ error: "PGP key not found" }, { status: 404 });

  try {
    const body = await req.json();
    const { name, description } = body;

    if (name !== undefined && (!name || typeof name !== "string" || !name.trim())) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const updated = updatePgpKey(Number(id), {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined
        ? { description: description?.trim() || null }
        : {}),
    });

    logAudit({
      userId: getUserId(session),
      action: "update",
      resource: "pgp_key",
      resourceId: Number(id),
      resourceName: updated?.name ?? existing.name,
      ipAddress: getIpFromRequest(req),
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update" },
        { status: 500 }
      );
    }

    const { privateKey: _pk, passphrase: _pp, ...safe } = updated;
    return NextResponse.json(safe);
  } catch (error) {
    log.error("PUT /pgp-keys/[id] failed", { error });
    return NextResponse.json(
      { error: "Failed to update PGP key" },
      { status: 500 }
    );
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
  const existing = getPgpKeyPublic(Number(id));
  if (!existing)
    return NextResponse.json({ error: "PGP key not found" }, { status: 404 });

  // Block deletion if the key is used by jobs
  const jobIds = getJobsUsingPgpKey(Number(id));
  if (jobIds.length > 0) {
    const jobRows = db
      .select({ id: jobs.id, name: jobs.name })
      .from(jobs)
      .where(inArray(jobs.id, jobIds))
      .all();
    return NextResponse.json(
      { error: "PGP key is in use", jobs: jobRows },
      { status: 409 }
    );
  }

  try {
    deletePgpKey(Number(id));

    logAudit({
      userId: getUserId(session),
      action: "delete",
      resource: "pgp_key",
      resourceId: Number(id),
      resourceName: existing.name,
      ipAddress: getIpFromRequest(req),
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    log.error("DELETE /pgp-keys/[id] failed", { error });
    return NextResponse.json(
      { error: "Failed to delete PGP key" },
      { status: 500 }
    );
  }
}
