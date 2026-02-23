import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getAllSsoConfigs, setSsoConfig } from "@/lib/db/sso-config";
import { refreshAuthConfig } from "@/lib/auth";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { z } from "zod";

const ssoConfigSchema = z.object({
  provider: z.enum(["azure-ad", "github"]),
  enabled: z.boolean(),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  tenantId: z.string().optional(),
});

export async function GET() {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const configs = getAllSsoConfigs();
  return NextResponse.json(configs);
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  try {
    const body = await req.json();
    const parsed = ssoConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { provider, enabled, clientId, clientSecret, tenantId } = parsed.data;

    if (provider === "azure-ad" && !tenantId) {
      return NextResponse.json(
        { error: "Tenant ID is required for Azure AD" },
        { status: 400 }
      );
    }

    setSsoConfig(provider, { enabled, clientId, clientSecret, tenantId });
    refreshAuthConfig();

    logAudit({
      userId: getUserId(session),
      action: "settings_change",
      resource: "settings",
      resourceName: `sso_${provider}`,
      ipAddress: getIpFromRequest(req),
      details: { provider, enabled },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save SSO config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
