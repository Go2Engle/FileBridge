import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { restoreBackup } from "@/lib/backup";
import { initializeScheduler } from "@/lib/scheduler";
import { initializeBackupScheduler } from "@/lib/backup";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { filename } = await req.json();

    if (!filename || typeof filename !== "string") {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }

    // Reject any path separators to prevent traversal
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    console.log(`[API] Restore requested: ${filename}`);
    await restoreBackup(filename);

    // Re-initialize schedulers so in-memory state matches the restored DB
    await initializeScheduler();
    await initializeBackupScheduler();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] POST /backup/restore:", error);
    const message = error instanceof Error ? error.message : "Restore failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
