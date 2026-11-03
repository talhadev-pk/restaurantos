import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  SESSION_COOKIE, createSession, destroySession, getSessionUser, sessionCookieOptions, verifyPassword,
} from "@/lib/auth";
import { audit, errorResponse, getAllSettings } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await ctx.params;
    if (action === "login") {
      const { email, password } = await req.json();
      if (!email || !password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
      const rows = await db
        .select({ user: s.users, role: s.roles })
        .from(s.users)
        .innerJoin(s.roles, eq(s.users.roleId, s.roles.id))
        .where(eq(s.users.email, String(email).toLowerCase().trim()))
        .limit(1);
      const row = rows[0];
      if (!row || !row.user.active || !verifyPassword(String(password), row.user.passwordHash)) {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
      }
      const token = await createSession(row.user.id);
      await audit({ id: row.user.id, name: row.user.name }, "login", "user", row.user.id);
      const res = NextResponse.json({
        user: { id: row.user.id, name: row.user.name, email: row.user.email, roleName: row.role.name, permissions: row.role.permissions },
      });
      res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      return res;
    }
    if (action === "logout") {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      if (token) await destroySession(token);
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
      return res;
    }
    return NextResponse.json({ error: "Unknown auth action." }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await ctx.params;
    if (action !== "me") return NextResponse.json({ error: "Unknown auth action." }, { status: 404 });
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const settings = await getAllSettings();
    return NextResponse.json({ user, settings });
  } catch (e) {
    return errorResponse(e);
  }
}
