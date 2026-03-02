import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db/users", () => ({
  isFirstRun: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getUserId: vi.fn((s) => s?.user?.email ?? "unknown"),
  getIpFromRequest: vi.fn(() => null),
  diffChanges: vi.fn(() => ({})),
}));

import { POST } from "@/app/api/setup/route";
import { isFirstRun, createUser } from "@/lib/db/users";

const mockUser = {
  id: 1,
  username: "admin",
  email: null,
  displayName: "Administrator",
  role: "admin" as const,
  isLocal: true,
  passwordHash: "hashed",
  ssoProvider: null,
  ssoId: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function makeRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const validPayload = {
  username: "admin",
  displayName: "Administrator",
  email: "",
  password: "SecurePass1",
  confirmPassword: "SecurePass1",
};

describe("POST /api/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirstRun).mockReturnValue(true);
    vi.mocked(createUser).mockResolvedValue(mockUser);
  });

  it("returns 403 if setup is already complete", async () => {
    vi.mocked(isFirstRun).mockReturnValue(false);
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/already completed/i);
  });

  it("returns 201 with userId on successful setup", async () => {
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.userId).toBe(1);
  });

  it("calls createUser with correct arguments", async () => {
    await POST(makeRequest(validPayload));
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "admin",
        displayName: "Administrator",
        role: "admin",
        isLocal: true,
      })
    );
  });

  it("returns 400 for a username that is too short", async () => {
    const res = await POST(makeRequest({ ...validPayload, username: "ab" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 3/i);
  });

  it("returns 400 for a username that is too long", async () => {
    const res = await POST(makeRequest({ ...validPayload, username: "a".repeat(51) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 50/i);
  });

  it("returns 400 for a username with invalid characters", async () => {
    const res = await POST(makeRequest({ ...validPayload, username: "user name!" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only contain/i);
  });

  it("returns 400 for a password that is too short", async () => {
    const res = await POST(makeRequest({ ...validPayload, password: "Short1", confirmPassword: "Short1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 8/i);
  });

  it("returns 400 for a password with no uppercase letter", async () => {
    const res = await POST(makeRequest({ ...validPayload, password: "alllower1", confirmPassword: "alllower1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/uppercase/i);
  });

  it("returns 400 for a password with no number", async () => {
    const res = await POST(makeRequest({ ...validPayload, password: "NoNumberHere", confirmPassword: "NoNumberHere" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/number/i);
  });

  it("returns 400 for a password with no lowercase letter", async () => {
    const res = await POST(makeRequest({ ...validPayload, password: "ALLCAPS123", confirmPassword: "ALLCAPS123" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/lowercase/i);
  });

  it("returns 400 when passwords do not match", async () => {
    const res = await POST(makeRequest({ ...validPayload, password: "SecurePass1", confirmPassword: "DifferentPass1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/do not match/i);
  });

  it("returns 400 for a missing display name", async () => {
    const res = await POST(makeRequest({ ...validPayload, displayName: "" }));
    expect(res.status).toBe(400);
  });

  it("accepts a username with dots, dashes, and underscores", async () => {
    const res = await POST(makeRequest({ ...validPayload, username: "my.user_name-1" }));
    expect(res.status).toBe(201);
  });

  it("returns 409 when username already exists", async () => {
    vi.mocked(createUser).mockRejectedValue(new Error("UNIQUE constraint failed: users.username"));
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/i);
  });

  it("returns 500 on unexpected database errors", async () => {
    vi.mocked(createUser).mockRejectedValue(new Error("Disk full"));
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Disk full");
  });
});
