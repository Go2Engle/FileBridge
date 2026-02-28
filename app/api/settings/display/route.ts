import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

const SETTINGS_KEY = "display";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  try {
    const row = await db.query.settings.findFirst({
      where: eq(settings.key, SETTINGS_KEY),
    });

    if (!row || !row.value) {
      return NextResponse.json({ timeFormat: "24h" });
    }

    return NextResponse.json(row.value);
  } catch (error) {
    log.error("GET /settings/display failed", { error });
    return NextResponse.json({ error: "Failed to fetch display settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  try {
    const body = await req.json();

    if (body.timeFormat !== "12h" && body.timeFormat !== "24h") {
      return NextResponse.json({ error: "Invalid timeFormat value" }, { status: 400 });
    }

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
      resourceName: "Display Settings",
      ipAddress: getIpFromRequest(req),
      details: { timeFormat: body.timeFormat },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("POST /settings/display failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to save display settings" }, { status: 500 });
  }
}
