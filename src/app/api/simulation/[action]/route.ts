import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse } from "@/lib/system";
import { getEngine, SimMode } from "@/lib/simulation/engine";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  try {
    await requireAuth();
    const { action } = await ctx.params;
    if (action === "status") {
      const engine = getEngine();
      try { await engine.pump(); } catch { /* tick errors are non-fatal */ }
      return NextResponse.json(await engine.snapshot());
    }
    if (action === "logs") {
      const events = await db.select().from(s.simulationEvents).orderBy(desc(s.simulationEvents.id)).limit(120);
      return NextResponse.json({ events });
    }
    if (action === "sessions") {
      const sessions = await db.select().from(s.simulationSessions).orderBy(desc(s.simulationSessions.id)).limit(20);
      return NextResponse.json({ sessions });
    }
    return NextResponse.json({ error: "Unknown simulation action." }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  try {
    const user = await requireAuth("simulation.control");
    const { action } = await ctx.params;
    const engine = getEngine();
    const body = await req.json().catch(() => ({}));

    if (action === "start") {
      const mode: SimMode = ["assisted", "automatic", "stress"].includes(body.mode) ? body.mode : "automatic";
      await engine.start(mode, {
        speed: Number(body.speed ?? engine.config.speed) || 1,
        arrivalSec: Number(body.arrivalSec ?? engine.config.arrivalSec) || 12,
        minItems: Number(body.minItems ?? engine.config.minItems) || 1,
        maxItems: Number(body.maxItems ?? engine.config.maxItems) || 4,
        operatingStart: Number(body.operatingStart ?? engine.config.operatingStart),
        operatingEnd: Number(body.operatingEnd ?? engine.config.operatingEnd),
      });
      await audit(user, "start", "simulation", engine.sessionId, { mode });
      return NextResponse.json(await engine.snapshot());
    }
    if (action === "pause") {
      await engine.pause();
      await audit(user, "pause", "simulation", engine.sessionId);
      return NextResponse.json(await engine.snapshot());
    }
    if (action === "resume") {
      await engine.resume();
      await audit(user, "resume", "simulation", engine.sessionId);
      return NextResponse.json(await engine.snapshot());
    }
    if (action === "stop") {
      const sid = engine.sessionId;
      await engine.stop();
      await audit(user, "stop", "simulation", sid);
      return NextResponse.json(await engine.snapshot());
    }
    if (action === "reset") {
      const summary = await engine.reset();
      await audit(user, "reset", "simulation", null, summary);
      return NextResponse.json({ snapshot: await engine.snapshot(), summary });
    }
    if (action === "config") {
      await engine.updateConfig({
        ...(body.speed !== undefined && { speed: Number(body.speed) || 1 }),
        ...(body.arrivalSec !== undefined && { arrivalSec: Number(body.arrivalSec) || 12 }),
        ...(body.minItems !== undefined && { minItems: Math.max(1, Number(body.minItems) || 1) }),
        ...(body.maxItems !== undefined && { maxItems: Math.max(1, Number(body.maxItems) || 4) }),
        ...(body.operatingStart !== undefined && { operatingStart: Number(body.operatingStart) }),
        ...(body.operatingEnd !== undefined && { operatingEnd: Number(body.operatingEnd) }),
      });
      return NextResponse.json(await engine.snapshot());
    }
    return NextResponse.json({ error: "Unknown simulation action." }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}
