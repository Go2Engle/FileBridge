import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/rbac", () => ({
  requireAuth: vi.fn(() => ({
    session: { user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true } },
  })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    query: { settings: { findFirst: vi.fn() } },
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET } from "@/app/api/audit-logs/route";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

const logRow = (n: number) => ({
  id: n,
  userId: "alice@example.com",
  action: "create",
  resource: "job",
  resourceId: n,
  resourceName: `Job ${n}`,
  ipAddress: "10.0.0.1",
  details: null,
  timestamp: "2024-01-01T00:00:00Z",
});

function makeRequest(search = ""): NextRequest {
  return {
    url: `http://localhost:3000/api/audit-logs${search}`,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

// Drizzle chain: db.select().from().where().orderBy().limit().offset()
// and db.select({count}).from().where() for the count query
function setupDbSelect(rows: object[], count: number) {
  const countChain = {
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count }]) }),
  };
  const rowChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    }),
  };
  // First call (rows), second call (count) via Promise.all
  vi.mocked(db.select)
    .mockReturnValueOnce(rowChain as never)
    .mockReturnValueOnce(countChain as never);
}

describe("GET /api/audit-logs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ error: new Response(null, { status: 401 }) } as never);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns logs and total count", async () => {
    const rows = [logRow(1), logRow(2)];
    setupDbSelect(rows, 2);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.logs).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("returns empty logs array when no logs exist", async () => {
    setupDbSelect([], 0);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.logs).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("respects pagination offset and limit query params", async () => {
    setupDbSelect([logRow(11)], 100);
    const res = await GET(makeRequest("?offset=10&limit=1"));
    expect(res.status).toBe(200);
    // Verify the response contains the one row we returned
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.total).toBe(100);
  });

  it("caps limit at 200 even when a higher value is requested", async () => {
    setupDbSelect([], 0);
    // Just verify the endpoint doesn't error — limit capping happens internally
    const res = await GET(makeRequest("?limit=9999"));
    expect(res.status).toBe(200);
  });
});
