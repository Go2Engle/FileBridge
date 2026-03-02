import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db before importing the route so the module sees a stub
vi.mock("@/lib/db", () => ({
  db: {
    run: vi.fn(),
  },
}));

vi.mock("@/lib/scheduler", () => ({
  getScheduledJobIds: vi.fn(() => [1, 2, 3]),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns status=ok and HTTP 200 when all checks pass", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.scheduler.status).toBe("ok");
  });

  it("includes the number of scheduled jobs", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(body.checks.scheduler.scheduledJobs).toBe(3);
  });

  it("includes uptime and version fields", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.version).toBe("string");
  });

  it("returns status=degraded and HTTP 503 when db throws", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.run).mockImplementationOnce(() => {
      throw new Error("SQLITE_CANTOPEN");
    });

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.database.status).toBe("error");
    expect(body.checks.database.error).toBe("SQLITE_CANTOPEN");
  });

  it("continues health check even when scheduler throws", async () => {
    const { getScheduledJobIds } = await import("@/lib/scheduler");
    vi.mocked(getScheduledJobIds).mockImplementationOnce(() => {
      throw new Error("Scheduler not running");
    });

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    // DB should still be ok, scheduler should show error but not crash the handler
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.scheduler.status).toBe("error");
  });
});
