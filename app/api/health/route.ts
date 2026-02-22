import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getScheduledJobIds } from "@/lib/scheduler";

// Public endpoint — no auth required so Kubernetes liveness/readiness probes work
export async function GET() {
  const checks: Record<string, unknown> = {};
  let healthy = true;

  // Database connectivity
  try {
    db.run(sql`SELECT 1`);
    checks.database = { status: "ok" };
  } catch (err) {
    healthy = false;
    checks.database = {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Scheduler status
  try {
    const scheduledJobIds = getScheduledJobIds();
    checks.scheduler = { status: "ok", scheduledJobs: scheduledJobIds.length };
  } catch (err) {
    checks.scheduler = {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const body = {
    status: healthy ? "ok" : "degraded",
    version: process.env.npm_package_version ?? "0.1.0",
    uptime: Math.floor(process.uptime()),
    checks,
  };

  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
