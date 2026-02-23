import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { deleteSsoConfig } from "@/lib/db/sso-config";
import { refreshAuthConfig } from "@/lib/auth";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { provider } = await params;
  deleteSsoConfig(provider);
  refreshAuthConfig();

  logAudit({
    userId: getUserId(session),
    action: "delete",
    resource: "settings",
    resourceName: `sso_${provider}`,
    ipAddress: getIpFromRequest(req),
  });

  return new NextResponse(null, { status: 204 });
}
