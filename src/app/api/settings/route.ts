import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, getAllSettings, setSetting } from "@/lib/system";

export const dynamic = "force-dynamic";

const EDITABLE_KEYS = [
  "displayName", "ownerEmail", "restaurantName", "currencySymbol", "allowNegativeStock",
  "simSpeed", "simArrivalSec", "simOperatingStart", "simOperatingEnd",
];

export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ settings: await getAllSettings(), editableKeys: EDITABLE_KEYS });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth("settings.edit");
    const body = await req.json();
    const updates: [string, string][] = [];
    for (const key of EDITABLE_KEYS) {
      if (body[key] !== undefined) {
        const value = String(body[key]).slice(0, 200);
        if (key === "ownerEmail" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
        }
        if (key === "displayName" && !value.trim()) {
          return NextResponse.json({ error: "Display name cannot be empty." }, { status: 400 });
        }
        updates.push([key, value]);
      }
    }
    if (!updates.length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    for (const [k, v] of updates) await setSetting(k, v);
    await audit({ id: user.id, name: user.name }, "update", "settings", null, Object.fromEntries(updates));
    return NextResponse.json({ settings: await getAllSettings() });
  } catch (e) {
    return errorResponse(e);
  }
}
