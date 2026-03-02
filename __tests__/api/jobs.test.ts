import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mockAdminSession = {
  user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true },
  expires: "2099-01-01T00:00:00Z",
};

vi.mock("@/lib/auth/rbac", () => ({
  requireAuth: vi.fn(() => ({ session: mockAdminSession })),
  requireRole: vi.fn(() => ({ session: mockAdminSession })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    query: { jobs: { findFirst: vi.fn() } },
  },
}));

vi.mock("@/lib/scheduler", () => ({
  getSchedulerTimezone: vi.fn().mockResolvedValue("UTC"),
  scheduleJob: vi.fn(),
  unscheduleJob: vi.fn(),
  rescheduleAllJobs: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getUserId: vi.fn(() => "admin@test.com"),
  getIpFromRequest: vi.fn(() => "127.0.0.1"),
  diffChanges: vi.fn(() => ({})),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "@/app/api/jobs/route";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const baseJob = {
  id: 1, name: "Daily Backup", sourceConnectionId: 1, sourcePath: "/src",
  destinationConnectionId: 2, destinationPath: "/dst", fileFilter: "",
  schedule: "0 2 * * *", postTransferAction: "retain", movePath: null,
  overwriteExisting: false, skipHiddenFiles: true, extractArchives: false,
  deltaSync: false, status: "inactive", lastRunAt: null, nextRunAt: null,
  folder: null, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
};

describe("GET /api/jobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ error: new Response(null, { status: 401 }) } as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns an array of jobs", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([baseJob]) }),
    } as never);
    const res = await GET();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Daily Backup");
  });

  it("includes a null nextRunAt for inactive jobs", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([{ ...baseJob, status: "inactive" }]) }),
    } as never);
    const res = await GET();
    const body = await res.json();
    expect(body[0].nextRunAt).toBeNull();
  });

  it("computes nextRunAt as a valid ISO string for active jobs", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([{ ...baseJob, status: "active", schedule: "0 2 * * *" }]),
      }),
    } as never);
    const res = await GET();
    const body = await res.json();
    expect(typeof body[0].nextRunAt).toBe("string");
    expect(new Date(body[0].nextRunAt).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("returns null nextRunAt for an invalid cron schedule", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([{ ...baseJob, status: "active", schedule: "not-a-cron" }]),
      }),
    } as never);
    const res = await GET();
    const body = await res.json();
    expect(body[0].nextRunAt).toBeNull();
  });
});

describe("POST /api/jobs", () => {
  beforeEach(() => vi.clearAllMocks());

  const newJobPayload = {
    name: "Test Job", sourceConnectionId: 1, sourcePath: "/in",
    destinationConnectionId: 2, destinationPath: "/out",
    schedule: "*/15 * * * *", postTransferAction: "retain",
  };

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(makeRequest(newJobPayload));
    expect(res.status).toBe(403);
  });

  it("creates a job and returns 201", async () => {
    const createdJob = { ...baseJob, ...newJobPayload, id: 42, status: "inactive" };
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([createdJob]) }),
    } as never);
    const res = await POST(makeRequest(newJobPayload));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Test Job");
  });

  it("defaults fileFilter to empty string when omitted", async () => {
    const createdJob = { ...baseJob, name: "New Job", fileFilter: "", id: 5 };
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([createdJob]) }),
    } as never);
    await POST(makeRequest({ ...newJobPayload, name: "New Job" }));
    const insertCall = vi.mocked(db.insert).mock.results[0].value;
    expect(insertCall.values).toHaveBeenCalledWith(
      expect.objectContaining({ fileFilter: "" })
    );
  });

  it("returns 500 on database error", async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(new Error("SQLITE_FULL")) }),
    } as never);
    const res = await POST(makeRequest(newJobPayload));
    expect(res.status).toBe(500);
  });
});
