import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mockAdminSession = { user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true } };
const mockViewerSession = { user: { email: "viewer@test.com", role: "viewer" as const, id: "2", isLocal: true } };

vi.mock("@/lib/auth/rbac", () => ({
  requireAuth: vi.fn(() => ({ session: mockAdminSession })),
  requireRole: vi.fn(() => ({ session: mockAdminSession })),
}));

vi.mock("@/lib/db/hooks", () => ({
  getAllHooks: vi.fn(() => []),
  createHook: vi.fn(),
  getHook: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
  getJobsUsingHook: vi.fn(() => []),
  getJobHooksWithDetail: vi.fn(() => []),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getUserId: vi.fn(() => "admin@test.com"),
  getIpFromRequest: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "@/app/api/hooks/route";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { getAllHooks, createHook } from "@/lib/db/hooks";

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

const mockHook = {
  id: 1, name: "My Webhook", type: "webhook" as const, config: '{"url":"https://example.com"}',
  enabled: true, description: null, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
};

describe("GET /api/hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ error: new Response(null, { status: 401 }) } as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the list of all hooks", async () => {
    vi.mocked(getAllHooks).mockReturnValue([mockHook]);
    const res = await GET();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("My Webhook");
  });
});

describe("POST /api/hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createHook).mockReturnValue(mockHook);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 401 }) } as never);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(makeRequest({ type: "webhook", config: { url: "https://x.com" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("returns 400 when name is empty string", async () => {
    const res = await POST(makeRequest({ name: "  ", type: "webhook", config: { url: "https://x.com" } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid hook type", async () => {
    const res = await POST(makeRequest({ name: "test", type: "sms", config: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/webhook.*shell.*email/i);
  });

  it("returns 400 for webhook without URL", async () => {
    const res = await POST(makeRequest({ name: "test", type: "webhook", config: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/url/i);
  });

  it("returns 400 for email hook without SMTP host", async () => {
    const res = await POST(makeRequest({ name: "test", type: "email", config: { from: "a@a.com", to: "b@b.com" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/smtp host/i);
  });

  it("returns 400 for email hook without from address", async () => {
    const res = await POST(makeRequest({ name: "test", type: "email", config: { host: "smtp.example.com", to: "b@b.com" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/from/i);
  });

  it("returns 400 for email hook without recipient", async () => {
    const res = await POST(makeRequest({ name: "test", type: "email", config: { host: "smtp.example.com", from: "a@a.com" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/recipient/i);
  });

  it("returns 400 for shell hook without command", async () => {
    const res = await POST(makeRequest({ name: "test", type: "shell", config: { command: "  " } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/command/i);
  });

  it("returns 400 for shell hook with no config.command", async () => {
    const res = await POST(makeRequest({ name: "test", type: "shell", config: {} }));
    expect(res.status).toBe(400);
  });

  it("creates a webhook hook and returns 201", async () => {
    const res = await POST(makeRequest({ name: "My Webhook", type: "webhook", config: { url: "https://example.com" } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("My Webhook");
  });

  it("creates an email hook and returns 201", async () => {
    vi.mocked(createHook).mockReturnValue({ ...mockHook, type: "email" });
    const res = await POST(makeRequest({
      name: "Email Alert",
      type: "email",
      config: { host: "smtp.example.com", from: "no-reply@example.com", to: "ops@example.com" },
    }));
    expect(res.status).toBe(201);
  });

  it("creates a shell hook and returns 201", async () => {
    vi.mocked(createHook).mockReturnValue({ ...mockHook, type: "shell" });
    const res = await POST(makeRequest({
      name: "Shell Hook",
      type: "shell",
      config: { command: "echo done" },
    }));
    expect(res.status).toBe(201);
  });
});
