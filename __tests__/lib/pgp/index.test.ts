// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  generateKeyPair,
  parseKeyMetadata,
  encryptBuffer,
  decryptBuffer,
  stripPgpExtension,
  isPgpFile,
} from "@/lib/pgp";

describe("PGP key generation", () => {
  it("generates an ECC Curve25519 keypair", async () => {
    const result = await generateKeyPair({
      name: "Test User",
      algorithm: "ecc-curve25519",
    });

    expect(result.publicKeyArmored).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    expect(result.privateKeyArmored).toContain("BEGIN PGP PRIVATE KEY BLOCK");
    expect(result.fingerprint).toMatch(/^[A-F0-9]{40}$/);
    expect(result.algorithm).toBe("curve25519");
    expect(result.userId).toContain("Test User");
    expect(result.keyExpiresAt).toBeNull();
  });

  it("generates an RSA 4096 keypair", async () => {
    const result = await generateKeyPair({
      name: "RSA User",
      algorithm: "rsa4096",
    });

    expect(result.publicKeyArmored).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    expect(result.fingerprint).toMatch(/^[A-F0-9]{40}$/);
    expect(result.algorithm).toBe("rsa4096");
  }, 30000); // RSA keygen is slow

  it("includes email in userId when provided", async () => {
    const result = await generateKeyPair({
      name: "Email User",
      email: "test@example.com",
      algorithm: "ecc-curve25519",
    });

    expect(result.userId).toContain("Email User");
    expect(result.userId).toContain("test@example.com");
  });

  it("sets expiration when expirationDays > 0", async () => {
    const result = await generateKeyPair({
      name: "Expiring Key",
      algorithm: "ecc-curve25519",
      expirationDays: 365,
    });

    expect(result.keyExpiresAt).not.toBeNull();
    const expires = new Date(result.keyExpiresAt!);
    const now = new Date();
    // Expiration should be roughly 365 days from now (within 2 days tolerance)
    const diffDays = (expires.getTime() - now.getTime()) / (1000 * 86400);
    expect(diffDays).toBeGreaterThan(363);
    expect(diffDays).toBeLessThan(367);
  });

  it("generates different fingerprints each time", async () => {
    const r1 = await generateKeyPair({ name: "Key 1", algorithm: "ecc-curve25519" });
    const r2 = await generateKeyPair({ name: "Key 2", algorithm: "ecc-curve25519" });
    expect(r1.fingerprint).not.toBe(r2.fingerprint);
  });
});

describe("parseKeyMetadata", () => {
  let publicKey: string;
  let privateKey: string;

  beforeEach(async () => {
    const kp = await generateKeyPair({ name: "Meta Test", email: "meta@test.com", algorithm: "ecc-curve25519" });
    publicKey = kp.publicKeyArmored;
    privateKey = kp.privateKeyArmored;
  });

  it("parses public key metadata", async () => {
    const meta = await parseKeyMetadata(publicKey);
    expect(meta.fingerprint).toMatch(/^[A-F0-9]{40}$/);
    expect(meta.isPrivate).toBe(false);
    expect(meta.userId).toContain("Meta Test");
    expect(meta.keyCreatedAt).toBeTruthy();
  });

  it("parses private key metadata", async () => {
    const meta = await parseKeyMetadata(privateKey);
    expect(meta.fingerprint).toMatch(/^[A-F0-9]{40}$/);
    expect(meta.isPrivate).toBe(true);
  });

  it("returns matching fingerprints for public and private keys", async () => {
    const pubMeta = await parseKeyMetadata(publicKey);
    const privMeta = await parseKeyMetadata(privateKey);
    expect(pubMeta.fingerprint).toBe(privMeta.fingerprint);
  });
});

describe("encryptBuffer / decryptBuffer", () => {
  let publicKey: string;
  let privateKey: string;

  beforeEach(async () => {
    const kp = await generateKeyPair({ name: "Buffer Test", algorithm: "ecc-curve25519" });
    publicKey = kp.publicKeyArmored;
    privateKey = kp.privateKeyArmored;
  });

  it("encrypts and decrypts a buffer round-trip", async () => {
    const plaintext = Buffer.from("Hello, PGP world!");
    const encrypted = await encryptBuffer(plaintext, publicKey);

    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.length).toBeGreaterThan(plaintext.length);

    const decrypted = await decryptBuffer(encrypted, privateKey);
    expect(decrypted.toString()).toBe("Hello, PGP world!");
  });

  it("encrypts and decrypts binary data", async () => {
    const binary = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binary[i] = i;

    const encrypted = await encryptBuffer(binary, publicKey);
    const decrypted = await decryptBuffer(encrypted, privateKey);
    expect(decrypted).toEqual(binary);
  });

  it("produces different ciphertext each encryption", async () => {
    const plaintext = Buffer.from("same input");
    const c1 = await encryptBuffer(plaintext, publicKey);
    const c2 = await encryptBuffer(plaintext, publicKey);
    expect(c1).not.toEqual(c2);
  });

  it("encrypts and decrypts with passphrase-protected key", async () => {
    const kp = await generateKeyPair({
      name: "Passphrase Test",
      algorithm: "ecc-curve25519",
      passphrase: "my-secret-passphrase",
    });

    const plaintext = Buffer.from("Secret data");
    const encrypted = await encryptBuffer(plaintext, kp.publicKeyArmored);
    const decrypted = await decryptBuffer(encrypted, kp.privateKeyArmored, "my-secret-passphrase");
    expect(decrypted.toString()).toBe("Secret data");
  });
});

describe("stripPgpExtension", () => {
  it("strips .pgp extension", () => {
    expect(stripPgpExtension("file.txt.pgp")).toBe("file.txt");
  });

  it("strips .gpg extension", () => {
    expect(stripPgpExtension("data.csv.gpg")).toBe("data.csv");
  });

  it("strips .asc extension", () => {
    expect(stripPgpExtension("report.pdf.asc")).toBe("report.pdf");
  });

  it("is case-insensitive", () => {
    expect(stripPgpExtension("file.PGP")).toBe("file");
    expect(stripPgpExtension("file.GPG")).toBe("file");
    expect(stripPgpExtension("file.ASC")).toBe("file");
  });

  it("returns unchanged name when no PGP extension", () => {
    expect(stripPgpExtension("file.txt")).toBe("file.txt");
    expect(stripPgpExtension("file")).toBe("file");
  });
});

describe("isPgpFile", () => {
  it("returns true for .pgp files", () => {
    expect(isPgpFile("file.pgp")).toBe(true);
  });

  it("returns true for .gpg files", () => {
    expect(isPgpFile("file.gpg")).toBe(true);
  });

  it("returns true for .asc files", () => {
    expect(isPgpFile("file.asc")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isPgpFile("FILE.PGP")).toBe(true);
    expect(isPgpFile("file.Gpg")).toBe(true);
  });

  it("returns false for non-PGP files", () => {
    expect(isPgpFile("file.txt")).toBe(false);
    expect(isPgpFile("file.csv")).toBe(false);
    expect(isPgpFile("pgp")).toBe(false);
  });
});
