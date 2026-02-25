import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createStorageProvider } from "@/lib/storage/registry";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const requestedPath = searchParams.get("path") || "/";

  const conn = await db.query.connections.findFirst({
    where: eq(connections.id, Number(id)),
  });
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const provider = createStorageProvider(
    conn as Parameters<typeof createStorageProvider>[0]
  );

  try {
    await provider.connect();

    // "." means "auto-detect": ask the server for its working directory.
    // This mirrors how WinSCP finds the correct starting folder without
    // requiring the user to configure a remote root path manually.
    let browsePath = requestedPath;
    if (requestedPath === "." && provider.getWorkingDirectory) {
      browsePath = await provider.getWorkingDirectory();
    }

    const entries = await provider.listDirectory(browsePath);
    await provider.disconnect();

    // Sort: directories first, then files, both alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ path: browsePath, entries });
  } catch (error) {
    try { await provider.disconnect(); } catch {}
    log.error("Browse failed", { connectionName: conn.name, browsePath, requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to browse" },
      { status: 500 }
    );
  }
}
