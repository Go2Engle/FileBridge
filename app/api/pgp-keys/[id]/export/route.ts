import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/rbac";
import { getPgpKey, getPgpKeyPublic } from "@/lib/db/pgp-keys";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = req.nextUrl.searchParams.get("type") || "public";

  if (type === "private") {
    // Exporting private keys requires admin
    const result = await requireRole("admin");
    if ("error" in result) return result.error;

    const key = getPgpKey(Number(id));
    if (!key)
      return NextResponse.json({ error: "PGP key not found" }, { status: 404 });
    if (!key.privateKey)
      return NextResponse.json(
        { error: "No private key available" },
        { status: 400 }
      );

    const filename = `${key.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-private.asc`;
    return new NextResponse(key.privateKey, {
      headers: {
        "Content-Type": "application/pgp-keys",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Public key export — any authenticated user
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const key = getPgpKeyPublic(Number(id));
  if (!key)
    return NextResponse.json({ error: "PGP key not found" }, { status: 404 });

  const filename = `${key.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-public.asc`;
  return new NextResponse(key.publicKey, {
    headers: {
      "Content-Type": "application/pgp-keys",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
