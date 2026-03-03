import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { getAllPgpKeys, createPgpKey } from "@/lib/db/pgp-keys";
import { generateKeyPair, parseKeyMetadata } from "@/lib/pgp";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";
import type { Session } from "next-auth";

const log = createLogger("api");

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  return NextResponse.json(getAllPgpKeys());
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "generate") {
      return await handleGenerate(body, session, req);
    } else if (action === "import") {
      return await handleImport(body, session, req);
    } else {
      return NextResponse.json(
        { error: "Action must be 'generate' or 'import'" },
        { status: 400 }
      );
    }
  } catch (error) {
    log.error("POST /pgp-keys failed", { error });
    const message =
      error instanceof Error ? error.message : "Failed to create PGP key";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleGenerate(
  body: Record<string, unknown>,
  session: Session,
  req: NextRequest
) {
  const { name, algorithm, email, passphrase, expirationDays } = body as {
    name?: string;
    algorithm?: string;
    email?: string;
    passphrase?: string;
    expirationDays?: number;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (algorithm !== "rsa4096" && algorithm !== "ecc-curve25519") {
    return NextResponse.json(
      { error: "Algorithm must be 'rsa4096' or 'ecc-curve25519'" },
      { status: 400 }
    );
  }

  const generated = await generateKeyPair({
    name: name.trim(),
    email: email || undefined,
    algorithm,
    passphrase: passphrase || undefined,
    expirationDays: expirationDays ?? 0,
  });

  const row = createPgpKey({
    name: name.trim(),
    keyType: "keypair",
    algorithm: generated.algorithm,
    fingerprint: generated.fingerprint,
    userId: generated.userId,
    keyCreatedAt: generated.keyCreatedAt,
    keyExpiresAt: generated.keyExpiresAt,
    publicKey: generated.publicKeyArmored,
    privateKey: generated.privateKeyArmored,
    passphrase: passphrase || null,
  });

  logAudit({
    userId: getUserId(session),
    action: "create",
    resource: "pgp_key",
    resourceId: row.id,
    resourceName: row.name,
    ipAddress: getIpFromRequest(req),
    details: { algorithm, keyType: "keypair", action: "generate" },
  });

  // Strip private material from response
  const { privateKey: _pk, passphrase: _pp, ...safe } = row;
  return NextResponse.json(safe, { status: 201 });
}

async function handleImport(
  body: Record<string, unknown>,
  session: Session,
  req: NextRequest
) {
  const { name, description, publicKey, privateKey, passphrase } = body as {
    name?: string;
    description?: string;
    publicKey?: string;
    privateKey?: string;
    passphrase?: string;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!publicKey || typeof publicKey !== "string") {
    return NextResponse.json(
      { error: "Public key is required" },
      { status: 400 }
    );
  }

  // Parse public key metadata
  const pubMeta = await parseKeyMetadata(publicKey);

  // If private key provided, validate it matches the public key
  let hasPrivateKey = false;
  if (privateKey && typeof privateKey === "string" && privateKey.trim()) {
    const privMeta = await parseKeyMetadata(privateKey);
    if (privMeta.fingerprint !== pubMeta.fingerprint) {
      return NextResponse.json(
        { error: "Private key fingerprint does not match public key" },
        { status: 400 }
      );
    }
    hasPrivateKey = true;
  }

  const row = createPgpKey({
    name: name.trim(),
    description: description?.trim() || null,
    keyType: hasPrivateKey ? "keypair" : "public",
    algorithm: pubMeta.algorithm,
    fingerprint: pubMeta.fingerprint,
    userId: pubMeta.userId,
    keyCreatedAt: pubMeta.keyCreatedAt,
    keyExpiresAt: pubMeta.keyExpiresAt,
    publicKey,
    privateKey: hasPrivateKey ? privateKey! : null,
    passphrase: passphrase || null,
  });

  logAudit({
    userId: getUserId(session),
    action: "create",
    resource: "pgp_key",
    resourceId: row.id,
    resourceName: row.name,
    ipAddress: getIpFromRequest(req),
    details: {
      algorithm: pubMeta.algorithm,
      keyType: hasPrivateKey ? "keypair" : "public",
      action: "import",
    },
  });

  const { privateKey: _pk, passphrase: _pp, ...safe } = row;
  return NextResponse.json(safe, { status: 201 });
}
