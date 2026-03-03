import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import {
  getPgpKeyPublic,
  createPgpKey,
  reassignPgpKey,
} from "@/lib/db/pgp-keys";
import { generateKeyPair } from "@/lib/pgp";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  const oldKey = getPgpKeyPublic(Number(id));
  if (!oldKey)
    return NextResponse.json({ error: "PGP key not found" }, { status: 404 });

  try {
    const body = await req.json();
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

    // Generate the new key
    const generated = await generateKeyPair({
      name: name.trim(),
      email: email || undefined,
      algorithm,
      passphrase: passphrase || undefined,
      expirationDays: expirationDays ?? 0,
    });

    const newRow = createPgpKey({
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

    // Reassign all jobs from old key to new key
    const updatedJobCount = reassignPgpKey(Number(id), newRow.id);

    logAudit({
      userId: getUserId(session),
      action: "create",
      resource: "pgp_key",
      resourceId: newRow.id,
      resourceName: newRow.name,
      ipAddress: getIpFromRequest(req),
      details: {
        algorithm,
        keyType: "keypair",
        action: "rotate",
        rotatedFromKeyId: Number(id),
        rotatedFromKeyName: oldKey.name,
        updatedJobCount,
      },
    });

    const { privateKey: _pk, passphrase: _pp, ...safe } = newRow;
    return NextResponse.json({ newKey: safe, updatedJobCount }, { status: 201 });
  } catch (error) {
    log.error("POST /pgp-keys/[id]/rotate failed", { error });
    const message =
      error instanceof Error ? error.message : "Failed to rotate PGP key";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
