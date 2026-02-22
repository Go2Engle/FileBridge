import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createStorageProvider } from "@/lib/storage/registry";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [conn] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, Number(id)));

  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const provider = createStorageProvider(conn);
  try {
    await provider.connect();
    const items = await provider.listDirectory("/");
    await provider.disconnect();
    return NextResponse.json({
      success: true,
      message: `Connected successfully. Found ${items.length} item(s) at root.`,
    });
  } catch (err) {
    await provider.disconnect().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
