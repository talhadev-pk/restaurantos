// Server-only: password hashing, sessions, RBAC.
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, gt, and } from "drizzle-orm";
import { ServiceError } from "./system";

const SESSION_COOKIE = "ros_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const ALL_PERMISSIONS = [
  "dashboard.view",
  "pos.use",
  "orders.manage",
  "kitchen.use",
  "tables.manage",
  "menu.edit",
  "recipes.edit",
  "inventory.manage",
  "purchasing.manage",
  "customers.manage",
  "reservations.manage",
  "employees.manage",
  "finance.manage",
  "reports.view",
  "simulation.control",
  "settings.edit",
  "audit.view",
] as const;

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  roleName: string;
  permissions: string[];
};

export function hasPerm(user: SessionUser | null, perm: string): boolean {
  if (!user) return false;
  return user.permissions.includes("*") || user.permissions.includes(perm);
}

export async function createSession(userId: number): Promise<string> {
  const token = randomUUID();
  await db.insert(s.sessions).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function destroySession(token: string) {
  await db.delete(s.sessions).where(eq(s.sessions.token, token));
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: SESSION_TTL_MS / 1000 };
}

export { SESSION_COOKIE };

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const rows = await db
      .select({
        id: s.users.id,
        name: s.users.name,
        email: s.users.email,
        active: s.users.active,
        roleName: s.roles.name,
        permissions: s.roles.permissions,
      })
      .from(s.sessions)
      .innerJoin(s.users, eq(s.sessions.userId, s.users.id))
      .innerJoin(s.roles, eq(s.users.roleId, s.roles.id))
      .where(and(eq(s.sessions.token, token), gt(s.sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (!row || !row.active) return null;
    return { id: row.id, name: row.name, email: row.email, roleName: row.roleName, permissions: row.permissions ?? [] };
  } catch {
    return null;
  }
}

/** Throws ServiceError(401/403) if not authenticated or lacking the permission. */
export async function requireAuth(perm?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ServiceError("You must be signed in to perform this action.", 401);
  if (perm && !hasPerm(user, perm)) {
    throw new ServiceError(`Your role (${user.roleName}) is not allowed to perform this action.`, 403);
  }
  return user;
}
