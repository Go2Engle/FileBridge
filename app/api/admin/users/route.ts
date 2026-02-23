import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getAllUsers, createUser } from "@/lib/db/users";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { z } from "zod";

const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal("")),
  role: z.enum(["admin", "viewer"]),
  isLocal: z.boolean(),
  password: z.string().min(8).max(128).optional().or(z.literal("")),
  ssoProvider: z.string().optional(),
});

export async function GET() {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const users = getAllUsers();
  // Strip password hashes
  const safeUsers = users.map(({ passwordHash, ...rest }) => rest);
  return NextResponse.json(safeUsers);
}

export async function POST(req: NextRequest) {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;
  const { session } = result;

  try {
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { username, displayName, email, role, isLocal, password, ssoProvider } =
      parsed.data;

    if (isLocal && !password) {
      return NextResponse.json(
        { error: "Password is required for local users" },
        { status: 400 }
      );
    }

    const user = await createUser({
      username,
      displayName,
      email: email || null,
      password: isLocal ? password : undefined,
      role,
      isLocal,
      ssoProvider: !isLocal ? ssoProvider : null,
    });

    logAudit({
      userId: getUserId(session),
      action: "create",
      resource: "user",
      resourceId: user.id,
      resourceName: username,
      ipAddress: getIpFromRequest(req),
      details: { role, isLocal },
    });

    const { passwordHash, ...safeUser } = user;
    return NextResponse.json(safeUser, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create user";
    if (message.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
