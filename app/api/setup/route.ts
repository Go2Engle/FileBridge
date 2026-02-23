import { NextRequest, NextResponse } from "next/server";
import { isFirstRun, createUser } from "@/lib/db/users";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const setupSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be at most 50 characters")
    .regex(/^[a-zA-Z0-9_.-]+$/, "Username can only contain letters, numbers, dots, hyphens, and underscores"),
  displayName: z.string().min(1, "Display name is required").max(100),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[0-9]/, "Must contain a number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export async function POST(req: NextRequest) {
  // Guard: only works during first run
  if (!isFirstRun()) {
    return NextResponse.json(
      { error: "Setup already completed" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const parsed = setupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { username, displayName, email, password } = parsed.data;

    const user = await createUser({
      username,
      displayName,
      email: email || null,
      password,
      role: "admin",
      isLocal: true,
    });

    logAudit({
      userId: username,
      action: "create",
      resource: "user",
      resourceId: user.id,
      resourceName: username,
      details: { context: "initial_setup", role: "admin" },
    });

    return NextResponse.json(
      { success: true, userId: user.id },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup failed";
    if (message.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
