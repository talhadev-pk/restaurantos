import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";
import { resolveRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { from, to } = resolveRange(new URL(req.url).searchParams);
    const rows = await db
      .select()
      .from(s.expenses)
      .where(and(gte(s.expenses.incurredAt, from), lte(s.expenses.incurredAt, to)))
      .orderBy(desc(s.expenses.incurredAt))
      .limit(300);
    return NextResponse.json({ expenses: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("finance.manage");
    const body = await req.json();
    const amountCents = Math.round(Number(body.amountCents));
    if (!(amountCents > 0)) throw new ServiceError("Amount must be greater than zero.");
    if (!body.description?.trim()) throw new ServiceError("Description is required.");
    const [row] = await db.insert(s.expenses).values({
      category: String(body.category ?? "general"),
      description: body.description.trim(),
      amountCents,
      incurredAt: body.incurredAt ? new Date(body.incurredAt) : new Date(),
    }).returning();
    await audit(user, "create", "expense", row.id, { amountCents });
    return NextResponse.json({ expense: row });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth("finance.manage");
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new ServiceError("Missing id.");
    await db.delete(s.expenses).where(eq(s.expenses.id, id));
    await audit(user, "delete", "expense", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
