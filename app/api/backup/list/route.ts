import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBackupConfig, listBackups } from "@/lib/backup";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const config = await getBackupConfig();
    const backups = listBackups(config.localPath);
    return NextResponse.json(backups);
  } catch (error) {
    log.error("GET /backup/list failed", { error });
    return NextResponse.json({ error: "Failed to list backups" }, { status: 500 });
  }
}
