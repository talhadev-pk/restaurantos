import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const rows = await db
      .select({ employee: s.employees, roleName: s.roles.name })
      .from(s.employees)
      .leftJoin(s.roles, eq(s.employees.roleId, s.roles.id))
      .orderBy(asc(s.employees.name));
    const today = new Date().toISOString().slice(0, 10);
    const att = await db.select().from(s.attendance).orderBy(desc(s.attendance.id)).limit(200);
    const byEmp = new Map<number, typeof att>();
    for (const a of att) {
      const arr = byEmp.get(a.employeeId) ?? [];
      arr.push(a);
      byEmp.set(a.employeeId, arr);
    }
    return NextResponse.json({
      employees: rows.map((r) => ({ ...r.employee, roleName: r.roleName, attendance: (byEmp.get(r.employee.id) ?? []).slice(0, 14) })),
      today,
      roles: await db.select().from(s.roles),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("employees.manage");
    const body = await req.json();

    if (body.action === "simulate_attendance") {
      const workDate = body.workDate ?? new Date().toISOString().slice(0, 10);
      const emps = await db.select().from(s.employees).where(eq(s.employees.status, "active"));
      let created = 0;
      for (const e of emps) {
        const existing = await db.select().from(s.attendance)
          .where(sql`${s.attendance.employeeId} = ${e.id} AND ${s.attendance.workDate} = ${workDate}`).limit(1);
        if (existing.length) continue;
        const r = Math.random();
        const status = r < 0.85 ? "present" : r < 0.93 ? "late" : "absent";
        const base = new Date(`${workDate}T08:00:00`);
        const checkIn = status === "absent" ? null : new Date(base.getTime() + Math.floor(Math.random() * (status === "late" ? 90 : 25)) * 60000);
        const checkOut = checkIn ? new Date(checkIn.getTime() + (7 + Math.random() * 2) * 3600000) : null;
        await db.insert(s.attendance).values({ employeeId: e.id, workDate, checkIn, checkOut, status, source: "simulation" });
        created++;
      }
      await audit(user, "simulate_attendance", "employee", null, { workDate, created });
      return NextResponse.json({ ok: true, created, workDate });
    }

    if (!body.name?.trim()) throw new ServiceError("Employee name is required.");
    if (!body.position?.trim()) throw new ServiceError("Position is required.");
    const [row] = await db.insert(s.employees).values({
      name: body.name.trim(),
      position: body.position.trim(),
      department: String(body.department ?? "Operations"),
      roleId: body.roleId ?? null,
      hourlyRateCents: Math.max(0, Math.round(body.hourlyRateCents ?? 1500)),
      isVirtual: body.isVirtual !== false,
    }).returning();
    await audit(user, "create", "employee", row.id, { name: row.name });
    return NextResponse.json({ employee: row });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth("employees.manage");
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new ServiceError("Missing id.");
    const body = await req.json();
    const [row] = await db.update(s.employees).set({
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.position !== undefined && { position: String(body.position).trim() }),
      ...(body.department !== undefined && { department: String(body.department) }),
      ...(body.roleId !== undefined && { roleId: body.roleId }),
      ...(body.hourlyRateCents !== undefined && { hourlyRateCents: Math.round(body.hourlyRateCents) }),
      ...(body.status !== undefined && { status: String(body.status) }),
    }).where(eq(s.employees.id, id)).returning();
    await audit(user, "update", "employee", id, body);
    return NextResponse.json({ employee: row });
  } catch (e) {
    return errorResponse(e);
  }
}
