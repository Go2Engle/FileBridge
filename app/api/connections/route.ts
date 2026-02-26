import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";
import { getAllConnections, encryptCreds } from "@/lib/db/connections";

const log = createLogger("api");

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const rows = getAllConnections();
  // Strip credentials — return only safe display fields
  const safeRows = rows.map(({ credentials, ...rest }) => ({
    ...rest,
    username: credentials?.username ?? "",
    basePath: credentials?.basePath ?? "",
  }));
  return NextResponse.json(safeRows);
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  try {
    const body = await req.json();
    const { name, protocol, host, port, credentials } = body;

    const [row] = await db
      .insert(connections)
      .values({ name, protocol, host, port, credentials: encryptCreds(credentials) })
      .returning();

    logAudit({
      userId: getUserId(session),
      action: "create",
      resource: "connection",
      resourceId: row.id,
      resourceName: row.name,
      ipAddress: getIpFromRequest(req),
      details: { protocol: row.protocol, host: row.host },
    });

    // Strip credentials from the response
    const { credentials: _creds, ...safeRow } = row;
    return NextResponse.json(safeRow, { status: 201 });
  } catch (error) {
    log.error("POST /connections failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
  }
}
