import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { sqlite } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

interface QueryOpts {
  limit: number; offset: number;
  search: string | null; status: string | null; jobId: string | null;
}

export async function GET(req: NextRequest) {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? "25")));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0"));
  const search = searchParams.get("search");
  const status = searchParams.get("status") as "success" | "failure" | null;
  const jobId = searchParams.get("jobId");
  const type = (searchParams.get("type") ?? "all") as "all" | "transfer" | "hook";

  try {
    if (type === "transfer") return transferOnly({ limit, offset, search, status, jobId });
    if (type === "hook") return hookOnly({ limit, offset, search, status, jobId });
    return unionAll({ limit, offset, search, status, jobId });
  } catch (error) {
    log.error("GET /logs failed", { requestId: req.headers.get("x-request-id") ?? undefined, error });
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

// ── Transfer-only ─────────────────────────────────────────────────────────

function transferOnly({ limit, offset, search, status, jobId }: QueryOpts) {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (search) { conds.push("t.file_name LIKE ?"); params.push(`%${search}%`); }
  if (status) { conds.push("t.status = ?"); params.push(status); }
  if (jobId)  { conds.push("t.job_id = ?"); params.push(Number(jobId)); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = sqlite.prepare(`
    SELECT 'transfer' AS log_type,
      t.id, t.job_id, t.job_run_id, j.name AS job_name,
      t.file_name, t.source_path, t.destination_path, t.file_size,
      t.transferred_at AS timestamp, t.status, t.error_message,
      NULL AS hook_name, NULL AS hook_type, NULL AS trigger, NULL AS duration_ms
    FROM transfer_logs t
    LEFT JOIN jobs j ON t.job_id = j.id
    ${where}
    ORDER BY t.transferred_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const [{ count }] = sqlite.prepare(
    `SELECT COUNT(*) AS count FROM transfer_logs t ${where}`
  ).all(...params) as [{ count: number }];

  return NextResponse.json({ logs: rows, total: Number(count) });
}

// ── Hook-only ─────────────────────────────────────────────────────────────

function hookOnly({ limit, offset, search, status, jobId }: QueryOpts) {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (search) { conds.push("h.hook_name LIKE ?"); params.push(`%${search}%`); }
  if (status) { conds.push("h.status = ?"); params.push(status); }
  if (jobId)  { conds.push("h.job_id = ?"); params.push(Number(jobId)); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = sqlite.prepare(`
    SELECT 'hook' AS log_type,
      h.id, h.job_id, h.job_run_id, j.name AS job_name,
      NULL AS file_name, NULL AS source_path, NULL AS destination_path, NULL AS file_size,
      h.executed_at AS timestamp, h.status, h.error_message,
      h.hook_name, h.hook_type, h.trigger, h.duration_ms
    FROM hook_runs h
    LEFT JOIN jobs j ON h.job_id = j.id
    ${where}
    ORDER BY h.executed_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const [{ count }] = sqlite.prepare(
    `SELECT COUNT(*) AS count FROM hook_runs h ${where}`
  ).all(...params) as [{ count: number }];

  return NextResponse.json({ logs: rows, total: Number(count) });
}

// ── UNION (all types) ─────────────────────────────────────────────────────

function unionAll({ limit, offset, search, status, jobId }: QueryOpts) {
  const tConds: string[] = [];
  const hConds: string[] = [];
  const tParams: unknown[] = [];
  const hParams: unknown[] = [];

  if (search) {
    tConds.push("t.file_name LIKE ?"); tParams.push(`%${search}%`);
    hConds.push("h.hook_name LIKE ?"); hParams.push(`%${search}%`);
  }
  if (status) {
    tConds.push("t.status = ?"); tParams.push(status);
    hConds.push("h.status = ?"); hParams.push(status);
  }
  if (jobId) {
    tConds.push("t.job_id = ?"); tParams.push(Number(jobId));
    hConds.push("h.job_id = ?"); hParams.push(Number(jobId));
  }

  const tWhere = tConds.length ? `WHERE ${tConds.join(" AND ")}` : "";
  const hWhere = hConds.length ? `WHERE ${hConds.join(" AND ")}` : "";

  const rows = sqlite.prepare(`
    SELECT 'transfer' AS log_type,
      t.id, t.job_id, t.job_run_id, j.name AS job_name,
      t.file_name, t.source_path, t.destination_path, t.file_size,
      t.transferred_at AS timestamp, t.status, t.error_message,
      NULL AS hook_name, NULL AS hook_type, NULL AS trigger, NULL AS duration_ms
    FROM transfer_logs t
    LEFT JOIN jobs j ON t.job_id = j.id
    ${tWhere}
    UNION ALL
    SELECT 'hook' AS log_type,
      h.id, h.job_id, h.job_run_id, j.name AS job_name,
      NULL AS file_name, NULL AS source_path, NULL AS destination_path, NULL AS file_size,
      h.executed_at AS timestamp, h.status, h.error_message,
      h.hook_name, h.hook_type, h.trigger, h.duration_ms
    FROM hook_runs h
    LEFT JOIN jobs j ON h.job_id = j.id
    ${hWhere}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...tParams, ...hParams, limit, offset);

  const [{ count }] = sqlite.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT t.id FROM transfer_logs t ${tWhere}
      UNION ALL
      SELECT h.id FROM hook_runs h ${hWhere}
    )
  `).all(...tParams, ...hParams) as [{ count: number }];

  return NextResponse.json({ logs: rows, total: Number(count) });
}
