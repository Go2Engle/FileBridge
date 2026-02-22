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
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const config = await getBackupConfig();
    return NextResponse.json(config);
  } catch (error) {
    log.error("GET /settings/backup failed", { error });
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

    logAudit({
      userId: getUserId(session),
      action: "settings_change",
      resource: "settings",
      resourceName: "backup",
      ipAddress: getIpFromRequest(req),
      details: { enabled: config.enabled, schedule: config.schedule, retentionCount: config.retentionCount },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("POST /settings/backup failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to save backup settings" }, { status: 500 });
  }
}
