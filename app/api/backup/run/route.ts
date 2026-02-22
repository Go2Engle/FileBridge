import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runBackup } from "@/lib/backup";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    console.log("[API] Manual backup triggered");
    const result = await runBackup();
    return NextResponse.json({
      success: true,
      filename: result.filename,
      sizeBytes: result.sizeBytes,
      createdAt: result.createdAt,
      integrity: result.integrity,
    });
  } catch (error) {
    console.error("[API] POST /backup/run:", error);
    const message = error instanceof Error ? error.message : "Backup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
