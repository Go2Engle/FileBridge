import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/rbac", () => ({
  requireRole: vi.fn(() => ({
    session: { user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true } },
  })),
}));

const mockProvider = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  getWorkingDirectory: vi.fn().mockResolvedValue("/home/user"),
  listDirectory: vi.fn().mockResolvedValue([
    { name: "file1.csv", size: 1024, isDirectory: false, modifiedAt: new Date() },
    { name: "reports", size: 0, isDirectory: true, modifiedAt: new Date() },
  ]),
};

vi.mock("@/lib/storage/registry", () => ({
  createStorageProvider: vi.fn(() => mockProvider),
}));

import { POST } from "@/app/api/connections/test/route";
import { requireRole } from "@/lib/auth/rbac";
import { createStorageProvider } from "@/lib/storage/registry";

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const validBody = {
  protocol: "sftp", host: "sftp.example.com", port: 22,
  credentials: { username: "user", password: "pass" },
};

describe("POST /api/connections/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.connect.mockResolvedValue(undefined);
    mockProvider.disconnect.mockResolvedValue(undefined);
  });

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
  });

  it("returns 400 if protocol is missing", async () => {
    const res = await POST(makeRequest({ host: "sftp.example.com", port: 22, credentials: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing/i);
  });

  it("returns 400 if host is missing", async () => {
    const res = await POST(makeRequest({ protocol: "sftp", port: 22, credentials: {} }));
    expect(res.status).toBe(400);
  });

  it("returns 400 if port is null", async () => {
    const res = await POST(makeRequest({ protocol: "sftp", host: "h", port: null, credentials: {} }));
    expect(res.status).toBe(400);
  });

  it("returns 400 if credentials are missing", async () => {
    const res = await POST(makeRequest({ protocol: "sftp", host: "h", port: 22 }));
    expect(res.status).toBe(400);
  });

  it("returns success:true and item count on successful connection", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("2 item(s)");
  });

  it("calls connect then listDirectory then disconnect in order", async () => {
    const order: string[] = [];
    mockProvider.connect.mockImplementation(async () => { order.push("connect"); });
    mockProvider.listDirectory.mockImplementation(async () => { order.push("list"); return []; });
    mockProvider.disconnect.mockImplementation(async () => { order.push("disconnect"); });
    await POST(makeRequest(validBody));
    expect(order).toEqual(["connect", "list", "disconnect"]);
  });

  it("returns success:false (HTTP 200) when connection fails", async () => {
    mockProvider.connect.mockRejectedValue(new Error("Connection refused"));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Connection refused");
  });

  it("still calls disconnect even when connection fails", async () => {
    mockProvider.connect.mockRejectedValue(new Error("Auth failed"));
    await POST(makeRequest(validBody));
    expect(mockProvider.disconnect).toHaveBeenCalled();
  });

  it("uses getWorkingDirectory when provider supports it", async () => {
    mockProvider.getWorkingDirectory.mockResolvedValue("/data/uploads");
    mockProvider.listDirectory.mockResolvedValue([]);
    const res = await POST(makeRequest(validBody));
    const body = await res.json();
    expect(body.message).toContain("/data/uploads");
  });

  it("falls back to '/' when getWorkingDirectory is not available", async () => {
    vi.mocked(createStorageProvider).mockReturnValue({
      ...mockProvider,
      getWorkingDirectory: undefined,
    } as never);
    mockProvider.listDirectory.mockResolvedValue([{ name: "a" }]);
    const res = await POST(makeRequest(validBody));
    const body = await res.json();
    expect(body.message).toContain("root");
  });
});
