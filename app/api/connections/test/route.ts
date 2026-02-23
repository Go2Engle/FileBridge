import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { createStorageProvider } from "@/lib/storage/registry";

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const body = await req.json();
  const { protocol, host, port, credentials } = body;

  if (!protocol || !host || port == null || !credentials) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const provider = createStorageProvider({ protocol, host, port, credentials });
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
