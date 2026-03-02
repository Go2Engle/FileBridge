import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

describe("encrypt() / decrypt()", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, AUTH_SECRET: "test-secret-key-for-unit-tests" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("encrypts and decrypts a simple string round-trip", () => {
    const plaintext = "hello world";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const plaintext = "same-input";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
    // But both must decrypt to the same value
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it("preserves special characters and unicode", () => {
    const inputs = [
      "P@ssw0rd!#$%^&*()_+",
      "パスワード",
      "密码123",
      'with "quotes" and \'apostrophes\'',
      "line1\nline2\ttabbed",
    ];
    for (const input of inputs) {
      expect(decrypt(encrypt(input))).toBe(input);
    }
  });

  it("preserves long strings (e.g. PEM private keys)", () => {
    const longString = "A".repeat(4096);
    expect(decrypt(encrypt(longString))).toBe(longString);
  });

  it("produces output in iv:tag:data format", () => {
    const ciphertext = encrypt("test");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    // Each part should be a valid base64 string
    for (const part of parts) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("throws when AUTH_SECRET is missing", () => {
    delete process.env.AUTH_SECRET;
    expect(() => encrypt("anything")).toThrow("AUTH_SECRET is required for encryption");
  });

  it("throws when decrypting tampered ciphertext", () => {
    const ciphertext = encrypt("data");
    // Corrupt the data portion
    const [iv, tag] = ciphertext.split(":");
    const tampered = `${iv}:${tag}:YWFhYWFh`; // invalid data
    expect(() => decrypt(tampered)).toThrow();
  });
});
