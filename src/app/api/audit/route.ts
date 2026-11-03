import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth("audit.view");
    const logs = await db.select().from(s.auditLogs).orderBy(desc(s.auditLogs.id)).limit(120);
    return NextResponse.json({ logs });
  } catch (e) {
    return errorResponse(e);
  }
}
