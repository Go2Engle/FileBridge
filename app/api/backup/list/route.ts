import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { getBackupConfig, listBackups } from "@/lib/backup";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET() {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  try {
    const config = await getBackupConfig();
    const backups = listBackups(config.localPath);
    return NextResponse.json(backups);
  } catch (error) {
    log.error("GET /backup/list failed", { error });
    return NextResponse.json({ error: "Failed to list backups" }, { status: 500 });
  }
}
