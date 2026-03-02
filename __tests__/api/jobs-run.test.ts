import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mockAdminSession = {
  user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true },
};

vi.mock("@/lib/auth/rbac", () => ({
  requireRole: vi.fn(() => ({ session: mockAdminSession })),
}));

vi.mock("@/lib/transfer/engine", () => ({
  runJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { jobs: { findFirst: vi.fn() } },
  },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getUserId: vi.fn(() => "admin@test.com"),
  getIpFromRequest: vi.fn(() => null),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "@/app/api/jobs/[id]/run/route";
import { requireRole } from "@/lib/auth/rbac";
import { runJob } from "@/lib/transfer/engine";
import { db } from "@/lib/db";

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return { headers: { get: (k: string) => headers[k] ?? null } } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/jobs/[id]/run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(makeRequest(), makeParams("1"));
    expect(res.status).toBe(403);
  });

  it("returns 200 and 'Job triggered' message", async () => {
    vi.mocked(db.query.jobs.findFirst).mockResolvedValue({ id: 1, name: "Test Job" } as never);
    const res = await POST(makeRequest(), makeParams("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/triggered/i);
  });

  it("calls runJob asynchronously (fire-and-forget)", async () => {
    vi.mocked(db.query.jobs.findFirst).mockResolvedValue({ id: 1, name: "Test Job" } as never);
    await POST(makeRequest(), makeParams("1"));
    // Give the async fire-and-forget a tick to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(runJob).toHaveBeenCalledWith(1);
  });

  it("still responds 200 even when the job does not exist in DB", async () => {
    vi.mocked(db.query.jobs.findFirst).mockResolvedValue(undefined as never);
    const res = await POST(makeRequest(), makeParams("99"));
    expect(res.status).toBe(200);
  });
});
