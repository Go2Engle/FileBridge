import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { datadogConfigInputSchema, resolveDatadogConfig } from "@/lib/datadog/config";
import { sendDatadogTestLog } from "@/lib/datadog/shipper";
import { getUserId } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

/**
 * Validate the API key and send one test log using the (possibly unsaved)
 * values from the admin form. A blank API key falls back to the stored one.
 */
export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const parsed = datadogConfigInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  }

  const config = resolveDatadogConfig(parsed.data);
  if (!config.apiKey) {
    return NextResponse.json({ error: "Enter an API key first" }, { status: 400 });
  }

  const outcome = await sendDatadogTestLog(config, getUserId(result.session));
  if (!outcome.ok) {
    log.warn("Datadog test failed", { step: outcome.step, error: outcome.error, site: config.site });
    return NextResponse.json(
      {
        error:
          outcome.step === "validate"
            ? `Could not validate API key: ${outcome.error}`
            : `API key is valid, but sending a log failed: ${outcome.error}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    message: `Test log sent. Look for service:${config.service || "filebridge"} in Datadog Logs.`,
  });
}
