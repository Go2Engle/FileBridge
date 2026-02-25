import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createStorageProvider } from "@/lib/storage/registry";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

/** DELETE /api/connections/[id]/files?path=... — delete a file */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const conn = await db.query.connections.findFirst({
    where: eq(connections.id, Number(id)),
  });
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const provider = createStorageProvider(
    conn as Parameters<typeof createStorageProvider>[0]
  );

  try {
    await provider.connect();
    await provider.deleteFile(filePath);
    await provider.disconnect();
    log.info("File deleted", { connectionName: conn.name, filePath });
    return NextResponse.json({ success: true });
  } catch (error) {
    try { await provider.disconnect(); } catch {}
    log.error("Delete failed", { connectionName: conn.name, filePath, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete" },
      { status: 500 }
    );
  }
}

/** PATCH /api/connections/[id]/files — rename or move an entry */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { from, to } = body ?? {};

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  const conn = await db.query.connections.findFirst({
    where: eq(connections.id, Number(id)),
  });
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const provider = createStorageProvider(
    conn as Parameters<typeof createStorageProvider>[0]
  );

  try {
    await provider.connect();
    await provider.moveFile(from, to);
    await provider.disconnect();
    log.info("Entry renamed/moved", { connectionName: conn.name, from, to });
    return NextResponse.json({ success: true });
  } catch (error) {
    try { await provider.disconnect(); } catch {}
    log.error("Rename/move failed", { connectionName: conn.name, from, to, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rename/move" },
      { status: 500 }
    );
  }
}
