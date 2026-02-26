import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { createStorageProvider } from "@/lib/storage/registry";
import { createLogger } from "@/lib/logger";
import { getConnection } from "@/lib/db/connections";

const log = createLogger("api");

/** POST /api/connections/[id]/mkdir — create a new directory */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { path: dirPath } = body ?? {};

  if (!dirPath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const conn = getConnection(Number(id));
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const provider = createStorageProvider(conn);

  try {
    await provider.connect();
    await provider.createDirectory(dirPath);
    await provider.disconnect();
    log.info("Directory created", { connectionName: conn.name, dirPath });
    return NextResponse.json({ success: true });
  } catch (error) {
    try { await provider.disconnect(); } catch {}
    log.error("mkdir failed", { connectionName: conn.name, dirPath, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create directory" },
      { status: 500 }
    );
  }
}
