import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import fs from "fs/promises";
import path from "path";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const { searchParams } = new URL(req.url);
  const browsePath = searchParams.get("path") || "/";

  try {
    const stat = await fs.stat(browsePath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const rawEntries = await fs.readdir(browsePath, { withFileTypes: true });

    const entries = (
      await Promise.all(
        rawEntries
          .filter((e) => e.isFile() || e.isDirectory())
          .map(async (e) => {
            try {
              const s = await fs.stat(path.join(browsePath, e.name));
              return {
                name: e.name,
                size: s.size,
                modifiedAt: s.mtime,
                isDirectory: e.isDirectory(),
              };
            } catch {
              // Skip entries we can't stat (e.g. permission denied)
              return null;
            }
          })
      )
    ).filter(Boolean);

    // Directories first, then files, both alphabetically
    entries.sort((a, b) => {
      if (a!.isDirectory !== b!.isDirectory) return a!.isDirectory ? -1 : 1;
      return a!.name.localeCompare(b!.name);
    });

    return NextResponse.json({ path: browsePath, entries });
  } catch (error) {
    log.error("Filesystem browse failed", { browsePath, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to browse" },
      { status: 500 }
    );
  }
}
