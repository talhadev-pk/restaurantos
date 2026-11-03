import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse, ServiceError } from "@/lib/system";
import { transitionOrder, TransitionAction } from "@/lib/services/orders";

export const dynamic = "force-dynamic";

const VALID_ACTIONS: TransitionAction[] = ["confirm", "start_prepare", "ready", "serve", "complete", "cancel", "refund"];

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const id = Number((await ctx.params).id);
    const [order] = await db.select().from(s.orders).where(eq(s.orders.id, id));
    if (!order) throw new ServiceError("Order not found.", 404);
    const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id));
    const [payment] = await db.select().from(s.payments).where(eq(s.payments.orderId, id)).limit(1);
    const orderRefunds = await db.select().from(s.refunds).where(eq(s.refunds.orderId, id));
    const [table] = order.tableId
      ? await db.select({ name: s.restaurantTables.name }).from(s.restaurantTables).where(eq(s.restaurantTables.id, order.tableId)).limit(1)
      : [];
    const [customer] = order.customerId
      ? await db.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, order.customerId)).limit(1)
      : [];
    return NextResponse.json({ order, items, payment: payment ?? null, refunds: orderRefunds, tableName: table?.name ?? null, customerName: customer?.name ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const id = Number((await ctx.params).id);
    if (!id) throw new ServiceError("Invalid order id.");
    const body = await req.json();
    const action = body.action as TransitionAction;
    if (!VALID_ACTIONS.includes(action)) throw new ServiceError("Invalid order action.");
    const can =
      user.permissions.includes("*") ||
      user.permissions.includes("orders.manage") ||
      (["confirm", "start_prepare", "ready", "serve"].includes(action) && user.permissions.includes("kitchen.use")) ||
      (["complete", "cancel"].includes(action) && user.permissions.includes("pos.use")) ||
      (action === "refund" && user.permissions.includes("finance.manage"));
    if (!can) throw new ServiceError(`Your role (${user.roleName}) is not allowed to perform this action.`, 403);

    const order = await transitionOrder({ id: user.id, name: user.name }, id, action, {
      paymentMethod: body.paymentMethod,
      reason: body.reason,
    });
    return NextResponse.json({ order });
  } catch (e) {
    return errorResponse(e);
  }
}
