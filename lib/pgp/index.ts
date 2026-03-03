import * as openpgp from "openpgp";
import { Readable } from "stream";
import { createLogger } from "@/lib/logger";

const log = createLogger("pgp");

// ── Key Generation ──────────────────────────────────────────────

export interface GenerateKeyOptions {
  name: string;
  email?: string;
  algorithm: "rsa4096" | "ecc-curve25519";
  passphrase?: string;
  expirationDays?: number; // 0 or undefined = no expiry
}

export interface GeneratedKeyResult {
  publicKeyArmored: string;
  privateKeyArmored: string;
  fingerprint: string;
  algorithm: string;
  keyCreatedAt: string;
  keyExpiresAt: string | null;
  userId: string;
}

export async function generateKeyPair(
  opts: GenerateKeyOptions
): Promise<GeneratedKeyResult> {
  const userIDs = {
    name: opts.name,
    ...(opts.email ? { email: opts.email } : {}),
  };

  const keyExpirationTime =
    opts.expirationDays && opts.expirationDays > 0
      ? opts.expirationDays * 86400
      : 0;

  const baseOpts = {
    userIDs: [userIDs],
    passphrase: opts.passphrase || undefined,
    keyExpirationTime: keyExpirationTime || undefined,
  };

  const { privateKey: privateKeyArmored, publicKey: publicKeyArmored } =
    opts.algorithm === "rsa4096"
      ? await openpgp.generateKey({ ...baseOpts, type: "rsa" as const, rsaBits: 4096 })
      : await openpgp.generateKey({ ...baseOpts, type: "curve25519" as const });

  // Parse the generated key to extract metadata
  const pubKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
  const fingerprint = pubKey.getFingerprint().toUpperCase();
  const algoInfo = pubKey.getAlgorithmInfo();
  const algorithm =
    algoInfo.algorithm === "rsaEncryptSign"
      ? `rsa${algoInfo.bits}`
      : opts.algorithm === "ecc-curve25519"
        ? "curve25519"
        : algoInfo.algorithm;

  const creationTime = pubKey.getCreationTime();
  const expirationTime = await pubKey.getExpirationTime();

  const userId = pubKey.getUserIDs()[0] || opts.name;

  return {
    publicKeyArmored,
    privateKeyArmored,
    fingerprint,
    algorithm,
    keyCreatedAt: creationTime.toISOString(),
    keyExpiresAt:
      expirationTime instanceof Date ? expirationTime.toISOString() : null,
    userId,
  };
}

// ── Key Parsing / Metadata ──────────────────────────────────────

export interface KeyMetadata {
  fingerprint: string;
  algorithm: string;
  keyCreatedAt: string;
  keyExpiresAt: string | null;
  userId: string | null;
  isPrivate: boolean;
}

export async function parseKeyMetadata(
  armoredKey: string
): Promise<KeyMetadata> {
  let isPrivate = false;
  let key: openpgp.Key;

  if (armoredKey.includes("PRIVATE KEY")) {
    const privKey = await openpgp.readPrivateKey({ armoredKey });
    key = privKey;
    isPrivate = true;
  } else {
    key = await openpgp.readKey({ armoredKey });
  }

  const fingerprint = key.getFingerprint().toUpperCase();
  const algoInfo = key.getAlgorithmInfo();
  const algorithm =
    algoInfo.algorithm === "rsaEncryptSign"
      ? `rsa${algoInfo.bits}`
      : algoInfo.algorithm;

  const creationTime = key.getCreationTime();
  const expirationTime = await key.getExpirationTime();
  const userIds = key.getUserIDs();

  return {
    fingerprint,
    algorithm,
    keyCreatedAt: creationTime.toISOString(),
    keyExpiresAt:
      expirationTime instanceof Date ? expirationTime.toISOString() : null,
    userId: userIds[0] || null,
    isPrivate,
  };
}

// ── Encryption ──────────────────────────────────────────────────

/**
 * Encrypt a Node.js Readable stream and return a new Readable with encrypted data.
 * Uses openpgp's web streams support for memory-efficient processing.
 */
export async function encryptStream(
  input: Readable,
  publicKeyArmored: string
): Promise<Readable> {
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

  // Convert Node Readable to web ReadableStream
  const webStream = Readable.toWeb(input) as ReadableStream<Uint8Array>;

  const message = await openpgp.createMessage({ binary: webStream });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: publicKey,
    format: "binary",
  });

  // encrypted is a web ReadableStream when input is a stream
  if (encrypted instanceof ReadableStream) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Readable.fromWeb(encrypted as any);
  }

  // Fallback: if openpgp returns Uint8Array directly
  return Readable.from(Buffer.from(encrypted as Uint8Array));
}

/**
 * Encrypt a buffer and return the encrypted buffer.
 * For the archive/buffered transfer path.
 */
export async function encryptBuffer(
  data: Buffer,
  publicKeyArmored: string
): Promise<Buffer> {
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

  const message = await openpgp.createMessage({ binary: new Uint8Array(data) });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: publicKey,
    format: "binary",
  });

  return Buffer.from(encrypted as Uint8Array);
}

// ── Decryption ──────────────────────────────────────────────────

async function getDecryptionKey(
  privateKeyArmored: string,
  passphrase?: string
): Promise<openpgp.PrivateKey> {
  const privateKey = await openpgp.readPrivateKey({
    armoredKey: privateKeyArmored,
  });
  if (passphrase) {
    return openpgp.decryptKey({ privateKey, passphrase });
  }
  return privateKey;
}

/**
 * Decrypt a Node.js Readable stream and return a new Readable with decrypted data.
 */
export async function decryptStream(
  input: Readable,
  privateKeyArmored: string,
  passphrase?: string
): Promise<Readable> {
  const decryptionKey = await getDecryptionKey(privateKeyArmored, passphrase);

  const webStream = Readable.toWeb(input) as ReadableStream<Uint8Array>;

  const message = await openpgp.readMessage({
    binaryMessage: webStream,
  });
  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: decryptionKey,
    format: "binary",
  });

  // data is a web ReadableStream when input is a stream
  if (data instanceof ReadableStream) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Readable.fromWeb(data as any);
  }

  // Fallback: if openpgp returns Uint8Array directly
  return Readable.from(Buffer.from(data as Uint8Array));
}

/**
 * Decrypt a buffer and return the decrypted buffer.
 * For the archive/buffered transfer path.
 */
export async function decryptBuffer(
  data: Buffer,
  privateKeyArmored: string,
  passphrase?: string
): Promise<Buffer> {
  const decryptionKey = await getDecryptionKey(privateKeyArmored, passphrase);

  const message = await openpgp.readMessage({
    binaryMessage: new Uint8Array(data),
  });
  const result = await openpgp.decrypt({
    message,
    decryptionKeys: decryptionKey,
    format: "binary",
  });

  return Buffer.from(result.data as Uint8Array);
}

// ── Utilities ───────────────────────────────────────────────────

const PGP_EXTENSIONS = [".pgp", ".gpg", ".asc"];

export function stripPgpExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const ext of PGP_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return fileName.slice(0, -ext.length);
    }
  }
  return fileName;
}

export function isPgpFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PGP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Suppress unused import warning for log - used in error handling
void log;
