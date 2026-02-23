import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import {
  getUserById,
  updateUser,
  deleteUser,
  getAdminCount,
  hashPassword,
} from "@/lib/db/users";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { z } from "zod";

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().or(z.literal("")).or(z.null()),
  role: z.enum(["admin", "viewer"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const { id } = await params;
  const user = getUserById(Number(id));
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { passwordHash, ...safeUser } = user;
  return NextResponse.json(safeUser);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  const userId = Number(id);

  const existing = getUserById(userId);
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updates: Parameters<typeof updateUser>[1] = {};

    if (parsed.data.displayName !== undefined)
      updates.displayName = parsed.data.displayName;
    if (parsed.data.email !== undefined)
      updates.email = parsed.data.email || null;
    if (parsed.data.isActive !== undefined)
      updates.isActive = parsed.data.isActive;

    // Prevent demoting the last admin
    if (parsed.data.role !== undefined && parsed.data.role !== existing.role) {
      if (existing.role === "admin" && parsed.data.role === "viewer") {
        const adminCount = getAdminCount();
        if (adminCount <= 1) {
          return NextResponse.json(
            { error: "Cannot demote the last administrator" },
            { status: 400 }
          );
        }
      }
      updates.role = parsed.data.role;
    }

    // Password reset
    if (parsed.data.password) {
      updates.passwordHash = await hashPassword(parsed.data.password);
    }

    const updated = updateUser(userId, updates);
    if (!updated)
      return NextResponse.json({ error: "Update failed" }, { status: 500 });

    logAudit({
      userId: getUserId(session),
      action: "update",
      resource: "user",
      resourceId: userId,
      resourceName: existing.username,
      ipAddress: getIpFromRequest(req),
      details: {
        fields: Object.keys(updates).filter((k) => k !== "passwordHash"),
      },
    });

    const { passwordHash, ...safeUser } = updated;
    return NextResponse.json(safeUser);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  const { id } = await params;
  const userId = Number(id);

  // Cannot delete self
  if (session.user.id === String(userId)) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  const existing = getUserById(userId);
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cannot delete the last admin
  if (existing.role === "admin") {
    const adminCount = getAdminCount();
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last administrator" },
        { status: 400 }
      );
    }
  }

  deleteUser(userId);

  logAudit({
    userId: getUserId(session),
    action: "delete",
    resource: "user",
    resourceId: userId,
    resourceName: existing.username,
    ipAddress: getIpFromRequest(req),
  });

  return new NextResponse(null, { status: 204 });
}
