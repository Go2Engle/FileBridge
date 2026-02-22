import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { connections, jobs } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest, diffChanges } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [conn] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, Number(id)));

  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(conn);
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
    const { name, protocol, host, port, credentials } = body;

    // Snapshot current state before update for diffing (exclude credentials from diff)
    const [before] = await db
      .select({ name: connections.name, protocol: connections.protocol, host: connections.host, port: connections.port })
      .from(connections)
      .where(eq(connections.id, Number(id)));

    const [row] = await db
      .update(connections)
      .set({
        name,
        protocol,
        host,
        port,
        credentials,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(connections.id, Number(id)))
      .returning();

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const changes = before
      ? diffChanges(
          before as unknown as Record<string, unknown>,
          { name: row.name, protocol: row.protocol, host: row.host, port: row.port },
          []
        )
      : {};

    logAudit({
      userId: getUserId(session),
      action: "update",
      resource: "connection",
      resourceId: row.id,
      resourceName: row.name,
      ipAddress: getIpFromRequest(req),
      details: Object.keys(changes).length > 0 ? changes : null,
    });

    const { credentials: _creds, ...safeRow } = row;
    return NextResponse.json(safeRow);
  } catch (error) {
    console.error("[API] PUT /connections/[id]:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const connId = Number(id);
  try {
    // Block deletion if any jobs still reference this connection
    const referencingJobs = await db
      .select({ id: jobs.id, name: jobs.name })
      .from(jobs)
      .where(
        or(
          eq(jobs.sourceConnectionId, connId),
          eq(jobs.destinationConnectionId, connId)
        )
      );

    if (referencingJobs.length > 0) {
      const names = referencingJobs.map((j) => `"${j.name}"`).join(", ");
      return NextResponse.json(
        { error: `Cannot delete: this connection is used by ${referencingJobs.length} job(s): ${names}. Delete those jobs first.` },
        { status: 409 }
      );
    }

    // Fetch name before deletion for audit record
    const [conn] = await db.select({ name: connections.name }).from(connections).where(eq(connections.id, connId));

    await db.delete(connections).where(eq(connections.id, connId));

    logAudit({
      userId: getUserId(session),
      action: "delete",
      resource: "connection",
      resourceId: connId,
      resourceName: conn?.name ?? null,
      ipAddress: getIpFromRequest(req),
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[API] DELETE /connections/[id]:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
