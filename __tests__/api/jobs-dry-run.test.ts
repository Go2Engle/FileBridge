import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/rbac", () => ({
  requireRole: vi.fn(() => ({
    session: { user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true } },
  })),
}));

vi.mock("@/lib/transfer/engine", () => ({
  dryRunJob: vi.fn(),
}));

import { POST } from "@/app/api/jobs/[id]/dry-run/route";
import { requireRole } from "@/lib/auth/rbac";
import { dryRunJob } from "@/lib/transfer/engine";

function makeRequest(): NextRequest {
  return { headers: { get: () => null } } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const mockDryRunResult = {
  wouldTransfer: [{ name: "report.csv", size: 1024, modifiedAt: new Date() }],
  skipped: [],
  totalFiles: 1,
  totalBytes: 1024,
};

describe("POST /api/jobs/[id]/dry-run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(makeRequest(), makeParams("1"));
    expect(res.status).toBe(403);
  });

  it("returns dry-run results on success", async () => {
    vi.mocked(dryRunJob).mockResolvedValue(mockDryRunResult as never);
    const res = await POST(makeRequest(), makeParams("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalFiles).toBe(1);
    expect(body.totalBytes).toBe(1024);
  });

  it("returns 404 when job is not found", async () => {
    vi.mocked(dryRunJob).mockRejectedValue(new Error("Job not found"));
    const res = await POST(makeRequest(), makeParams("999"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("returns 500 on unexpected engine errors", async () => {
    vi.mocked(dryRunJob).mockRejectedValue(new Error("Connection refused"));
    const res = await POST(makeRequest(), makeParams("1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Connection refused");
  });

  it("passes the correct numeric job ID to dryRunJob", async () => {
    vi.mocked(dryRunJob).mockResolvedValue({ wouldTransfer: [], skipped: [], totalFiles: 0, totalBytes: 0 } as never);
    await POST(makeRequest(), makeParams("42"));
    expect(dryRunJob).toHaveBeenCalledWith(42);
  });
});
