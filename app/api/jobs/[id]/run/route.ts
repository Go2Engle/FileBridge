import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runJob } from "@/lib/transfer/engine";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const jobId = Number(id);

  // Run asynchronously — don't block the response
  runJob(jobId).catch((err) =>
    console.error(`[API] Manual run of job ${jobId} failed:`, err)
  );

  return NextResponse.json({ message: "Job triggered" });
}
