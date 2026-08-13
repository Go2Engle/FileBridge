import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "crypto";
import { normalizePemKey } from "@/lib/storage/pem";
// Reach into ssh2's parser directly — it is what actually rejects a flattened
// key, so asserting against it is what makes these tests meaningful.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseKey } = require("ssh2/lib/protocol/keyParser.js");

function parses(key: string, passphrase?: string): boolean {
  return !(parseKey(key, passphrase) instanceof Error);
}

function generatePkcs1(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  }).privateKey;
}

function generateEncryptedPkcs1(cipher: string, passphrase: string): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem", cipher, passphrase },
  }).privateKey;
}

describe("normalizePemKey()", () => {
  it("leaves a well-formed key byte-for-byte unchanged", () => {
    const key = generatePkcs1();
    expect(normalizePemKey(key)).toBe(key);
  });

  it("repairs a PKCS#1 key flattened onto one line", () => {
    const flattened = generatePkcs1().replace(/\n/g, "");
    expect(parses(flattened)).toBe(false); // the bug being fixed
    expect(parses(normalizePemKey(flattened))).toBe(true);
  });

  it("repairs a key whose newlines became spaces", () => {
    const spaced = generatePkcs1().replace(/\n/g, " ");
    expect(parses(spaced)).toBe(false);
    expect(parses(normalizePemKey(spaced))).toBe(true);
  });

  it("repairs a flattened EC (SEC1) key", () => {
    const ec = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "sec1", format: "pem" },
    }).privateKey;
    expect(parses(normalizePemKey(ec.replace(/\n/g, "")))).toBe(true);
  });

  it("wraps the body at 64 characters", () => {
    const lines = normalizePemKey(generatePkcs1().replace(/\n/g, "")).trim().split("\n");
    const body = lines.slice(1, -1);
    expect(body.length).toBeGreaterThan(1);
    for (const line of body.slice(0, -1)) expect(line).toHaveLength(64);
    expect(body.at(-1)!.length).toBeLessThanOrEqual(64);
  });

  it.each([
    ["AES-256-CBC (32-hex IV)", "aes-256-cbc"],
    ["DES-EDE3-CBC (16-hex IV)", "des-ede3-cbc"],
  ])("recovers the Proc-Type/DEK-Info headers of a flattened %s key", (_label, cipher) => {
    const key = generateEncryptedPkcs1(cipher, "hunter2");
    const repaired = normalizePemKey(key.replace(/\n/g, ""));

    expect(repaired).toContain("Proc-Type: 4,ENCRYPTED");
    // The IV must be split back out of the base64 body at exactly the right
    // offset, otherwise decryption produces garbage rather than an error.
    expect(repaired.split("\n").slice(0, 4)).toEqual(key.split("\n").slice(0, 4));
    expect(parses(repaired, "hunter2")).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   \n  "],
    ["text that is not a PEM block", "just some text"],
    ["mismatched BEGIN/END labels", "-----BEGIN RSA PRIVATE KEY-----MIIabc-----END DSA PRIVATE KEY-----"],
    ["an empty body", "-----BEGIN RSA PRIVATE KEY----------END RSA PRIVATE KEY-----"],
    [
      "an unrecognized DEK-Info cipher",
      "-----BEGIN RSA PRIVATE KEY-----Proc-Type: 4,ENCRYPTEDDEK-Info: BLOWFISH-CBC,ABCD1234MIIabc-----END RSA PRIVATE KEY-----",
    ],
  ])("returns %s unchanged so ssh2 reports the real problem", (_label, input) => {
    expect(normalizePemKey(input)).toBe(input);
  });
});
