import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getBackupConfig,
  saveBackupConfig,
  initializeBackupScheduler,
  DEFAULT_BACKUP_CONFIG,
  BackupConfig,
} from "@/lib/backup";
import cron from "node-cron";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const config = await getBackupConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[API] GET /settings/backup:", error);
    return NextResponse.json({ error: "Failed to fetch backup settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();

    const config: BackupConfig = {
      enabled: Boolean(body.enabled ?? DEFAULT_BACKUP_CONFIG.enabled),
      schedule: String(body.schedule ?? DEFAULT_BACKUP_CONFIG.schedule),
      localPath: String(body.localPath ?? DEFAULT_BACKUP_CONFIG.localPath),
      retentionCount: Number(body.retentionCount ?? DEFAULT_BACKUP_CONFIG.retentionCount),
    };

    if (!cron.validate(config.schedule)) {
      return NextResponse.json(
        { error: `Invalid cron expression: "${config.schedule}"` },
        { status: 400 }
      );
    }

    if (config.retentionCount < 1 || config.retentionCount > 365) {
      return NextResponse.json(
        { error: "retentionCount must be between 1 and 365" },
        { status: 400 }
      );
    }

    await saveBackupConfig(config);

    // Re-initialize the scheduler with the new config
    await initializeBackupScheduler();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] POST /settings/backup:", error);
    return NextResponse.json({ error: "Failed to save backup settings" }, { status: 500 });
  }
}
