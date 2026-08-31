import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  cancelActiveJob: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireRole: vi.fn(() => ({
    session: { user: { email: "admin@test.com", role: "admin" } },
  })),
}));

vi.mock("@/lib/transfer/cancellation", () => ({
  cancelActiveJob: mocks.cancelActiveJob,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { jobs: { findFirst: mocks.findFirst } },
    update: mocks.update,
  },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
  getUserId: vi.fn(() => "admin@test.com"),
  getIpFromRequest: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "@/app/api/jobs/[id]/cancel/route";
import { requireRole } from "@/lib/auth/rbac";

function request(): NextRequest {
  return { headers: { get: () => null } } as unknown as NextRequest;
}

function params(id = "1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/jobs/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ id: 1, name: "Import", status: "running" });
    mocks.update.mockImplementation(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    }));
  });

  it("requires an administrator", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({
      error: new Response(null, { status: 403 }),
    } as never);
    expect((await POST(request(), params())).status).toBe(403);
  });

  it("returns a conflict when the job is not running", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 1, name: "Import", status: "active" });
    const response = await POST(request(), params());
    expect(response.status).toBe(409);
    expect(mocks.cancelActiveJob).not.toHaveBeenCalled();
  });

  it("requests cancellation of the live engine task", async () => {
    mocks.cancelActiveJob.mockReturnValueOnce(new Promise<void>(() => {}));
    const response = await POST(request(), params());
    expect(response.status).toBe(202);
    expect(mocks.cancelActiveJob).toHaveBeenCalledWith(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("recovers a stale running row when no engine task exists", async () => {
    mocks.cancelActiveJob.mockReturnValueOnce(null);
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ details: { trigger: "manual_stop", recovery: "stale_reset" } }),
    );
  });
});
