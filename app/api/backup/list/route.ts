import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBackupConfig, listBackups } from "@/lib/backup";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const config = await getBackupConfig();
    const backups = listBackups(config.localPath);
    return NextResponse.json(backups);
  } catch (error) {
    console.error("[API] GET /backup/list:", error);
    return NextResponse.json({ error: "Failed to list backups" }, { status: 500 });
  }
}
