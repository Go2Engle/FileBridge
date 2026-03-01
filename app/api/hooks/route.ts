import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { getAllHooks, createHook } from "@/lib/db/hooks";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  return NextResponse.json(getAllHooks());
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  try {
    const body = await req.json();
    const { name, description, type, config, enabled } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (type !== "webhook" && type !== "shell") {
      return NextResponse.json({ error: "Type must be 'webhook' or 'shell'" }, { status: 400 });
    }
    if (!config || typeof config !== "object") {
      return NextResponse.json({ error: "Config is required" }, { status: 400 });
    }

    if (type === "webhook") {
      if (!config.url || typeof config.url !== "string") {
        return NextResponse.json({ error: "Webhook URL is required" }, { status: 400 });
      }
    } else {
      if (!config.command || typeof config.command !== "string" || !config.command.trim()) {
        return NextResponse.json({ error: "Shell command is required" }, { status: 400 });
      }
    }

    const row = createHook({
      name: name.trim(),
      description: description?.trim() || null,
      type,
      config: JSON.stringify(config),
      enabled: enabled !== false,
    });

    logAudit({
      userId: getUserId(session),
      action: "create",
      resource: "settings",
      resourceId: row.id,
      resourceName: row.name,
      ipAddress: getIpFromRequest(req),
      details: { type: row.type },
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    log.error("POST /hooks failed", { error });
    return NextResponse.json({ error: "Failed to create hook" }, { status: 500 });
  }
}
