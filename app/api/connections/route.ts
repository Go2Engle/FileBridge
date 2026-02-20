import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(connections).orderBy(desc(connections.createdAt));
  return NextResponse.json(rows);
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

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error("[API] POST /connections:", error);
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
  }
}
