import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(connections).orderBy(desc(connections.createdAt));
  // Strip credentials — return only safe display fields
  const safeRows = rows.map(({ credentials, ...rest }) => ({
    ...rest,
    username: (credentials as Record<string, string>)?.username ?? "",
  }));
  return NextResponse.json(safeRows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { name, protocol, host, port, credentials } = body;

    const [row] = await db
      .insert(connections)
      .values({ name, protocol, host, port, credentials })
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
    console.error("[API] POST /connections:", error);
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
  }
}
