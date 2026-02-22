import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

const SETTINGS_KEY = "notifications";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const row = await db.query.settings.findFirst({
      where: eq(settings.key, SETTINGS_KEY),
    });

    if (!row || !row.value) {
      return NextResponse.json({
        emailEnabled: false,
        emailSmtpHost: "",
        emailSmtpPort: 587,
        emailSmtpUser: "",
        emailSmtpPassword: "",
        emailRecipients: "",
        teamsWebhookEnabled: false,
        teamsWebhookUrl: "",
        alertOnFailure: true,
        alertOnConsecutiveErrors: 3,
      });
    }

    return NextResponse.json(row.value);
  } catch (error) {
    log.error("GET /settings failed", { error });
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();

    await db
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: body })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: body },
      });

    logAudit({
      userId: getUserId(session),
      action: "settings_change",
      resource: "settings",
      resourceName: "notifications",
      ipAddress: getIpFromRequest(req),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("POST /settings failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
