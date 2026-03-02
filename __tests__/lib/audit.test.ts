import { describe, it, expect } from "vitest";
import { getIpFromRequest, getUserId, diffChanges } from "@/lib/audit";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";

// Minimal NextRequest mock — only needs .headers
function makeRequest(headers: Record<string, string>): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe("getIpFromRequest()", () => {
  it("returns the first IP from x-forwarded-for", () => {
    const req = makeRequest({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3" });
    expect(getIpFromRequest(req)).toBe("10.0.0.1");
  });

  it("trims whitespace from the forwarded IP", () => {
    const req = makeRequest({ "x-forwarded-for": "  192.168.1.1 , 10.0.0.1" });
    expect(getIpFromRequest(req)).toBe("192.168.1.1");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = makeRequest({ "x-real-ip": "172.16.0.5" });
    expect(getIpFromRequest(req)).toBe("172.16.0.5");
  });

  it("returns null when no IP headers are present", () => {
    const req = makeRequest({});
    expect(getIpFromRequest(req)).toBeNull();
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    const req = makeRequest({
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "9.9.9.9",
    });
    expect(getIpFromRequest(req)).toBe("1.2.3.4");
  });
});

describe("getUserId()", () => {
  it("returns email when present", () => {
    const session = { user: { email: "alice@example.com", name: "Alice" } } as Session;
    expect(getUserId(session)).toBe("alice@example.com");
  });

  it("falls back to name when email is absent", () => {
    const session = { user: { name: "bob" } } as Session;
    expect(getUserId(session)).toBe("bob");
  });

  it("returns 'unknown' when both email and name are absent", () => {
    const session = { user: {} } as Session;
    expect(getUserId(session)).toBe("unknown");
  });
});

describe("diffChanges()", () => {
  it("detects changed fields", () => {
    const before = { name: "old-name", port: 22 };
    const after  = { name: "new-name", port: 22 };
    const diff = diffChanges(before, after);
    expect(diff).toEqual({ name: { from: "old-name", to: "new-name" } });
  });

  it("returns empty object when nothing changed", () => {
    const obj = { a: 1, b: "x" };
    expect(diffChanges(obj, { ...obj })).toEqual({});
  });

  it("detects added keys", () => {
    const diff = diffChanges({}, { newKey: "value" });
    expect(diff.newKey).toEqual({ from: undefined, to: "value" });
  });

  it("detects removed keys (value becomes undefined)", () => {
    const diff = diffChanges({ removedKey: "was-here" }, {});
    expect(diff.removedKey).toEqual({ from: "was-here", to: undefined });
  });

  it("skips fields in the skip list", () => {
    const before = { password: "secret", name: "old" };
    const after  = { password: "new-secret", name: "new" };
    const diff = diffChanges(before, after, ["password"]);
    expect(diff).not.toHaveProperty("password");
    expect(diff.name).toEqual({ from: "old", to: "new" });
  });

  it("handles multiple changed fields", () => {
    const before = { a: 1, b: 2, c: 3 };
    const after  = { a: 10, b: 2, c: 30 };
    const diff = diffChanges(before, after);
    expect(Object.keys(diff)).toHaveLength(2);
    expect(diff.a).toEqual({ from: 1, to: 10 });
    expect(diff.c).toEqual({ from: 3, to: 30 });
  });
});
