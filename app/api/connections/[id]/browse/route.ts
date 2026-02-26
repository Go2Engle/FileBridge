import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { createStorageProvider } from "@/lib/storage/registry";
import { createLogger } from "@/lib/logger";
import { getConnection } from "@/lib/db/connections";

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

  const conn = getConnection(Number(id));
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const provider = createStorageProvider(conn);

  // Declared outside try so it's accessible in the catch log below.
  let browsePath = requestedPath;

  try {
    await provider.connect();

    // "." means "auto-detect": ask the server for its working directory.
    // This mirrors how WinSCP finds the correct starting folder without
    // requiring the user to configure a remote root path manually.
    if (requestedPath === ".") {
      browsePath = provider.getWorkingDirectory
        ? await provider.getWorkingDirectory()
        : "/";
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
