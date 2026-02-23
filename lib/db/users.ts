import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  user: User,
  password: string
): Promise<boolean> {
  if (!user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export function isFirstRun(): boolean {
  const result = db.select({ value: count() }).from(users).get();
  return !result || result.value === 0;
}

export async function createUser(data: {
  username: string;
  email?: string | null;
  password?: string;
  displayName: string;
  role: "admin" | "viewer";
  isLocal: boolean;
  ssoProvider?: string | null;
  ssoId?: string | null;
}): Promise<User> {
  const passwordHash = data.password
    ? await hashPassword(data.password)
    : null;

  const user = db
    .insert(users)
    .values({
      username: data.username,
      email: data.email ?? null,
      passwordHash,
      displayName: data.displayName,
      role: data.role,
      isLocal: data.isLocal,
      ssoProvider: data.ssoProvider ?? null,
      ssoId: data.ssoId ?? null,
    })
    .returning()
    .get();

  return user;
}

export function getUserByUsername(username: string): User | undefined {
  return db.select().from(users).where(eq(users.username, username)).get();
}

export function getUserByEmail(email: string): User | undefined {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export function getUserById(id: number): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function getUserBySsoId(
  provider: string,
  ssoId: string
): User | undefined {
  return db
    .select()
    .from(users)
    .where(and(eq(users.ssoProvider, provider), eq(users.ssoId, ssoId)))
    .get();
}

export function updateLastLogin(userId: number): void {
  db.update(users)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(users.id, userId))
    .run();
}

export function getAllUsers(): User[] {
  return db.select().from(users).all();
}

export function updateUser(
  id: number,
  data: Partial<{
    username: string;
    email: string | null;
    passwordHash: string | null;
    displayName: string;
    role: "admin" | "viewer";
    isLocal: boolean;
    ssoProvider: string | null;
    ssoId: string | null;
    isActive: boolean;
  }>
): User | undefined {
  const updated = db
    .update(users)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id))
    .returning()
    .get();
  return updated;
}

export function deleteUser(id: number): void {
  db.delete(users).where(eq(users.id, id)).run();
}

export function getAdminCount(): number {
  const result = db
    .select({ value: count() })
    .from(users)
    .where(eq(users.role, "admin"))
    .get();
  return result?.value ?? 0;
}
