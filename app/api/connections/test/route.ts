import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createStorageProvider } from "@/lib/storage/registry";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { protocol, host, port, credentials } = body;

  if (!protocol || !host || !port || !credentials) {
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
