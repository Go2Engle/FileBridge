import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";
import { rescheduleAllJobs } from "@/lib/scheduler";

const log = createLogger("api");
const SETTINGS_KEY = "timezone";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    const row = await db.query.settings.findFirst({
      where: eq(settings.key, SETTINGS_KEY),
    });

    const val = row?.value as { timezone?: string } | undefined;
    return NextResponse.json({ timezone: val?.timezone ?? "UTC" });
  } catch (error) {
    log.error("GET /settings/timezone failed", { error });
    return NextResponse.json({ error: "Failed to fetch timezone setting" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  try {
    const body = await req.json();
    const { timezone } = body;

    if (typeof timezone !== "string" || !timezone) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    }

    // Validate IANA timezone identifier
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: "Invalid timezone identifier" }, { status: 400 });
    }

    await db
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: { timezone } })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: { timezone } },
      });

    // Reschedule all active jobs with the updated timezone
    await rescheduleAllJobs();

    logAudit({
      userId: getUserId(session),
      action: "settings_change",
      resource: "settings",
      resourceName: "timezone",
      ipAddress: getIpFromRequest(req),
      details: { timezone },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("POST /settings/timezone failed", {
      requestId: req.headers.get("x-request-id") ?? undefined,
      error,
    });
    return NextResponse.json({ error: "Failed to save timezone setting" }, { status: 500 });
  }
}
