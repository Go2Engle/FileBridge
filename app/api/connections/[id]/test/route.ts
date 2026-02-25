import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createStorageProvider } from "@/lib/storage/registry";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const { id } = await params;
  const [conn] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, Number(id)));

  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const provider = createStorageProvider(conn);
  try {
    await provider.connect();
    const testPath = provider.getWorkingDirectory
      ? await provider.getWorkingDirectory()
      : "/";
    const items = await provider.listDirectory(testPath);
    await provider.disconnect();
    const pathLabel = testPath === "/" ? "root" : testPath;
    return NextResponse.json({
      success: true,
      message: `Connected successfully. Found ${items.length} item(s) at ${pathLabel}.`,
    });
  } catch (err) {
    await provider.disconnect().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
