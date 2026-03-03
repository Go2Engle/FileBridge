import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mockAdminSession = {
  user: { email: "admin@test.com", role: "admin" as const, id: "1", isLocal: true },
};

vi.mock("@/lib/auth/rbac", () => ({
  requireAuth: vi.fn(() => ({ session: mockAdminSession })),
  requireRole: vi.fn(() => ({ session: mockAdminSession })),
}));

vi.mock("@/lib/db/pgp-keys", () => ({
  getAllPgpKeys: vi.fn(() => []),
  getPgpKeyPublic: vi.fn(),
  createPgpKey: vi.fn(),
  updatePgpKey: vi.fn(),
  deletePgpKey: vi.fn(),
  getJobsUsingPgpKey: vi.fn(() => []),
  reassignPgpKey: vi.fn(() => 0),
}));

vi.mock("@/lib/pgp", () => ({
  generateKeyPair: vi.fn(() => ({
    publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----\ntest\n-----END PGP PUBLIC KEY BLOCK-----",
    privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----\ntest\n-----END PGP PRIVATE KEY BLOCK-----",
    fingerprint: "AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555",
    algorithm: "curve25519",
    keyCreatedAt: "2026-01-01T00:00:00.000Z",
    keyExpiresAt: null,
    userId: "Test User",
  })),
  parseKeyMetadata: vi.fn(() => ({
    fingerprint: "AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555",
    algorithm: "curve25519",
    keyCreatedAt: "2026-01-01T00:00:00.000Z",
    keyExpiresAt: null,
    userId: "Test User",
    isPrivate: false,
  })),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getUserId: vi.fn(() => "admin@test.com"),
  getIpFromRequest: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "@/app/api/pgp-keys/route";
import { GET as GET_ONE, PUT, DELETE } from "@/app/api/pgp-keys/[id]/route";
import { POST as ROTATE } from "@/app/api/pgp-keys/[id]/rotate/route";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import {
  getAllPgpKeys,
  getPgpKeyPublic,
  createPgpKey,
  updatePgpKey,
  deletePgpKey,
  getJobsUsingPgpKey,
  reassignPgpKey,
} from "@/lib/db/pgp-keys";

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return {
    json: () => Promise.resolve(body),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const mockKey = {
  id: 1,
  name: "Test Key",
  description: null,
  keyType: "keypair" as const,
  algorithm: "curve25519",
  fingerprint: "AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555",
  userId: "Test User",
  keyCreatedAt: "2026-01-01T00:00:00.000Z",
  keyExpiresAt: null,
  publicKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\ntest\n-----END PGP PUBLIC KEY BLOCK-----",
  privateKey: "encrypted-private-key",
  passphrase: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const mockKeySafe = (() => {
  const { privateKey: _pk, passphrase: _pp, ...rest } = mockKey;
  return rest;
})();

// ── GET /api/pgp-keys ────────────────────────────────────────────

describe("GET /api/pgp-keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ error: new Response(null, { status: 401 }) } as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the list of all keys", async () => {
    vi.mocked(getAllPgpKeys).mockReturnValue([mockKeySafe]);
    const res = await GET();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Test Key");
  });

  it("returns empty array when no keys", async () => {
    vi.mocked(getAllPgpKeys).mockReturnValue([]);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

// ── POST /api/pgp-keys (generate) ───────────────────────────────

describe("POST /api/pgp-keys (generate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createPgpKey).mockReturnValue(mockKey);
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
    const res = await POST(makeRequest({ action: "generate", algorithm: "ecc-curve25519" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("returns 400 when name is blank", async () => {
    const res = await POST(makeRequest({ action: "generate", name: "  ", algorithm: "ecc-curve25519" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when algorithm is invalid", async () => {
    const res = await POST(makeRequest({ action: "generate", name: "Key", algorithm: "dsa1024" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/algorithm/i);
  });

  it("returns 400 for invalid action", async () => {
    const res = await POST(makeRequest({ action: "delete" }));
    expect(res.status).toBe(400);
  });

  it("generates a key and returns 201", async () => {
    const res = await POST(makeRequest({
      action: "generate",
      name: "Test Key",
      algorithm: "ecc-curve25519",
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Test Key");
    expect(body).not.toHaveProperty("privateKey");
    expect(body).not.toHaveProperty("passphrase");
  });
});

// ── POST /api/pgp-keys (import) ─────────────────────────────────

describe("POST /api/pgp-keys (import)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createPgpKey).mockReturnValue({ ...mockKey, keyType: "public" as const, privateKey: null });
  });

  it("returns 400 when public key is missing", async () => {
    const res = await POST(makeRequest({ action: "import", name: "Imported" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/public key/i);
  });

  it("imports a public-only key and returns 201", async () => {
    const res = await POST(makeRequest({
      action: "import",
      name: "Partner Key",
      publicKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\ndata\n-----END PGP PUBLIC KEY BLOCK-----",
    }));
    expect(res.status).toBe(201);
  });
});

// ── GET /api/pgp-keys/[id] ──────────────────────────────────────

describe("GET /api/pgp-keys/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ error: new Response(null, { status: 401 }) } as never);
    const res = await GET_ONE({} as NextRequest, makeParams("1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when key does not exist", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(undefined);
    const res = await GET_ONE({} as NextRequest, makeParams("999"));
    expect(res.status).toBe(404);
  });

  it("returns a single key", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    const res = await GET_ONE({} as NextRequest, makeParams("1"));
    const body = await res.json();
    expect(body.name).toBe("Test Key");
    expect(body.fingerprint).toBe("AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555");
  });
});

// ── PUT /api/pgp-keys/[id] ──────────────────────────────────────

describe("PUT /api/pgp-keys/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await PUT(makeRequest({ name: "Updated" }), makeParams("1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when key does not exist", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(undefined);
    const res = await PUT(makeRequest({ name: "Updated" }), makeParams("999"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when name is empty", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    const res = await PUT(makeRequest({ name: "  " }), makeParams("1"));
    expect(res.status).toBe(400);
  });

  it("updates name and returns the key", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    vi.mocked(updatePgpKey).mockReturnValue({ ...mockKey, name: "Renamed" });
    const res = await PUT(makeRequest({ name: "Renamed" }), makeParams("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Renamed");
    expect(body).not.toHaveProperty("privateKey");
  });
});

// ── DELETE /api/pgp-keys/[id] ────────────────────────────────────

describe("DELETE /api/pgp-keys/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await DELETE(makeRequest(null), makeParams("1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when key does not exist", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(undefined);
    const res = await DELETE(makeRequest(null), makeParams("999"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when key is used by jobs", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    vi.mocked(getJobsUsingPgpKey).mockReturnValue([
      { jobId: 1, jobName: "Daily Transfer", usedForEncrypt: true, usedForDecrypt: false },
    ]);
    const res = await DELETE(makeRequest(null), makeParams("1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/in use/i);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].name).toBe("Daily Transfer");
  });

  it("deletes the key and returns 204", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    vi.mocked(getJobsUsingPgpKey).mockReturnValue([]);
    const res = await DELETE(makeRequest(null), makeParams("1"));
    expect(res.status).toBe(204);
    expect(deletePgpKey).toHaveBeenCalledWith(1);
  });
});

// ── POST /api/pgp-keys/[id]/rotate ──────────────────────────────

describe("POST /api/pgp-keys/[id]/rotate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createPgpKey).mockReturnValue({ ...mockKey, id: 2, name: "Rotated Key" });
  });

  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const res = await ROTATE(makeRequest({}), makeParams("1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when source key does not exist", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(undefined);
    const res = await ROTATE(
      makeRequest({ name: "New", algorithm: "ecc-curve25519" }),
      makeParams("999"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when name is missing", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    const res = await ROTATE(
      makeRequest({ algorithm: "ecc-curve25519" }),
      makeParams("1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("returns 400 when algorithm is invalid", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    const res = await ROTATE(
      makeRequest({ name: "New", algorithm: "bad" }),
      makeParams("1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/algorithm/i);
  });

  it("rotates a key, creates new key, and reassigns jobs", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    vi.mocked(reassignPgpKey).mockReturnValue(3);

    const res = await ROTATE(
      makeRequest({ name: "Rotated Key", algorithm: "ecc-curve25519" }),
      makeParams("1"),
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.newKey.name).toBe("Rotated Key");
    expect(body.newKey).not.toHaveProperty("privateKey");
    expect(body.newKey).not.toHaveProperty("passphrase");
    expect(body.updatedJobCount).toBe(3);

    expect(reassignPgpKey).toHaveBeenCalledWith(1, 2);
  });

  it("returns updatedJobCount of 0 when no jobs use the key", async () => {
    vi.mocked(getPgpKeyPublic).mockReturnValue(mockKeySafe);
    vi.mocked(reassignPgpKey).mockReturnValue(0);

    const res = await ROTATE(
      makeRequest({ name: "New Key", algorithm: "rsa4096" }),
      makeParams("1"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.updatedJobCount).toBe(0);
  });
});
