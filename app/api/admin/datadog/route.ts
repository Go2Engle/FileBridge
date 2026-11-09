import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import {
  datadogConfigInputSchema,
  getDatadogConfig,
  resolveDatadogConfig,
  saveDatadogConfig,
  toPublicDatadogConfig,
} from "@/lib/datadog/config";
import { getShipperStats } from "@/lib/datadog/shipper";
import { getIpFromRequest, getUserId, logAudit } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function GET() {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  try {
    return NextResponse.json({
      config: toPublicDatadogConfig(getDatadogConfig()),
      stats: getShipperStats(),
    });
  } catch (error) {
    log.error("GET /admin/datadog failed", { error });
    return NextResponse.json({ error: "Failed to load Datadog settings" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const parsed = datadogConfigInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  }

  const config = resolveDatadogConfig(parsed.data);
  if (config.enabled && !config.apiKey) {
    return NextResponse.json({ error: "An API key is required to enable log forwarding" }, { status: 400 });
  }

  try {
    const before = toPublicDatadogConfig(getDatadogConfig());
    saveDatadogConfig(config);
    const after = toPublicDatadogConfig(config);

    logAudit({
      userId: getUserId(result.session),
      action: "settings_change",
      resource: "settings",
      resourceName: "datadog",
      ipAddress: getIpFromRequest(req),
      details: {
        enabled: { from: before.enabled, to: after.enabled },
        site: after.site,
        apiKeyChanged: !!parsed.data.apiKey,
      },
    });
    log.info("Datadog log forwarding settings updated", { enabled: config.enabled, site: config.site });

    return NextResponse.json({ config: after, stats: getShipperStats() });
  } catch (error) {
    log.error("PUT /admin/datadog failed", { error });
    return NextResponse.json({ error: "Failed to save Datadog settings" }, { status: 500 });
  }
}
