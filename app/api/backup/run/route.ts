import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { runBackup } from "@/lib/backup";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function POST() {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  try {
    log.info("Manual backup triggered");
    const result = await runBackup();
    return NextResponse.json({
      success: true,
      filename: result.filename,
      sizeBytes: result.sizeBytes,
      createdAt: result.createdAt,
      integrity: result.integrity,
    });
  } catch (error) {
    log.error("POST /backup/run failed", { error });
    const message = error instanceof Error ? error.message : "Backup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
