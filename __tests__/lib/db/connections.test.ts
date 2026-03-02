import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

// Set AUTH_SECRET before any imports touch crypto
process.env.AUTH_SECRET = "test-secret-key-for-connections-tests";

// Mock db — encryptCreds/decryptCreds don't use db, but connections.ts imports it
vi.mock("@/lib/db", () => ({ db: {} }));

import { encryptCreds, decryptCreds } from "@/lib/db/connections";

describe("encryptCreds() / decryptCreds()", () => {
  it("round-trips a simple credentials object", () => {
    const creds = { username: "alice", password: "s3cr3t" };
    const encrypted = encryptCreds(creds);
    expect(decryptCreds(encrypted)).toEqual(creds);
  });

  it("produces an opaque encrypted string (not plain JSON)", () => {
    const creds = { username: "bob", password: "hunter2" };
    const encrypted = encryptCreds(creds);
    // Should not be parseable as plain JSON
    expect(() => JSON.parse(encrypted)).toThrow();
    // Should not contain the password in plaintext
    expect(encrypted).not.toContain("hunter2");
  });

  it("round-trips credentials with many fields (Azure blob)", () => {
    const creds = {
      accountName: "mystorageaccount",
      accountKey: "base64keyvalue==",
      containerName: "filebridge-uploads",
    };
    expect(decryptCreds(encryptCreds(creds))).toEqual(creds);
  });

  it("round-trips credentials with unicode and special characters", () => {
    const creds = { password: "P@ss!#$%^~【日本語】" };
    expect(decryptCreds(encryptCreds(creds))).toEqual(creds);
  });

  it("produces a different encrypted string each call (random IV)", () => {
    const creds = { username: "alice" };
    const e1 = encryptCreds(creds);
    const e2 = encryptCreds(creds);
    expect(e1).not.toBe(e2);
    // Both still decrypt to same object
    expect(decryptCreds(e1)).toEqual(creds);
    expect(decryptCreds(e2)).toEqual(creds);
  });

  it("decryptCreds handles legacy plaintext JSON (migration guard)", () => {
    // Before encryption was added, credentials were stored as plain JSON
    const legacyCreds = { username: "legacy-user", host: "old-server.example.com" };
    const legacyStored = JSON.stringify(legacyCreds);
    expect(decryptCreds(legacyStored)).toEqual(legacyCreds);
  });

  it("decryptCreds returns empty object for completely invalid input", () => {
    expect(decryptCreds("definitely-not-valid-anything")).toEqual({});
  });
});
