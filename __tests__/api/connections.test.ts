import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mockAdminSession = {
  user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true },
};

vi.mock("@/lib/auth/rbac", () => ({
  requireAuth: vi.fn(() => ({ session: mockAdminSession })),
  requireRole: vi.fn(() => ({ session: mockAdminSession })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(),
  },
}));

vi.mock("@/lib/db/connections", () => ({
  getAllConnections: vi.fn(),
  encryptCreds: vi.fn((c) => `enc:${JSON.stringify(c)}`),
  decryptCreds: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getUserId: vi.fn(() => "admin@test.com"),
  getIpFromRequest: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "@/app/api/connections/route";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { getAllConnections } from "@/lib/db/connections";
import { db } from "@/lib/db";

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const mockConnection = {
  id: 1, name: "SFTP Server", protocol: "sftp" as const, host: "sftp.example.com", port: 22,
  folder: "/uploads", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
  credentials: { username: "sftpuser", password: "sftppass" },
};

describe("GET /api/connections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ error: new Response(null, { status: 401 }) } as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns a list of connections", async () => {
    vi.mocked(getAllConnections).mockReturnValue([mockConnection]);
    const res = await GET();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it("strips the credentials object from each connection", async () => {
    vi.mocked(getAllConnections).mockReturnValue([mockConnection]);
    const res = await GET();
    const body = await res.json();
    expect(body[0]).not.toHaveProperty("credentials");
  });

  it("exposes username (safe field) from credentials", async () => {
    vi.mocked(getAllConnections).mockReturnValue([mockConnection]);
    const res = await GET();
    const body = await res.json();
    expect(body[0].username).toBe("sftpuser");
  });

  it("does not expose the password", async () => {
    vi.mocked(getAllConnections).mockReturnValue([mockConnection]);
    const res = await GET();
    const body = await res.json();
    expect(body[0]).not.toHaveProperty("password");
    expect(JSON.stringify(body)).not.toContain("sftppass");
  });
});

describe("POST /api/connections", () => {
  beforeEach(() => vi.clearAllMocks());

  const newConn = {
    name: "My SFTP", protocol: "sftp", host: "sftp.example.com", port: 22,
    credentials: { username: "user", password: "pass" }, folder: "/uploads",
  };

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(makeRequest(newConn));
    expect(res.status).toBe(403);
  });

  it("creates a connection and returns 201", async () => {
    const created = { ...newConn, id: 5, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" };
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([created]) }),
    } as never);
    const res = await POST(makeRequest(newConn));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("My SFTP");
    // credentials must not appear in the response
    expect(body).not.toHaveProperty("credentials");
  });

  it("returns 500 on database error", async () => {
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(new Error("DB locked")) }),
    } as never);
    const res = await POST(makeRequest(newConn));
    expect(res.status).toBe(500);
  });
});
