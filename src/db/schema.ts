import {
  pgTable, serial, integer, text, boolean, timestamp, doublePrecision, jsonb, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ---------- Auth / RBAC ----------
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  roleId: integer("role_id").notNull().references(() => roles.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const branches = pgTable("branches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Floor ----------
export const restaurantTables = pgTable("restaurant_tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  capacity: integer("capacity").notNull().default(2),
  status: text("status").notNull().default("available"), // available | occupied | reserved | cleaning
  note: text("note").notNull().default(""),
  posX: integer("pos_x").notNull().default(0),
  posY: integer("pos_y").notNull().default(0),
  branchId: integer("branch_id").references(() => branches.id),
  active: boolean("active").notNull().default(true),
}, (t) => [index("tables_status_idx").on(t.status)]);

// ---------- Menu ----------
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => categories.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  taxRateBp: integer("tax_rate_bp").notNull().default(850), // basis points, 850 = 8.5%
  sku: text("sku"),
  color: text("color").notNull().default("amber"),
  available: boolean("available").notNull().default(true),
  branchId: integer("branch_id").references(() => branches.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("products_category_idx").on(t.categoryId)]);

export const productModifiers = pgTable("product_modifiers", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priceDeltaCents: integer("price_delta_cents").notNull().default(0),
});

// ---------- Inventory & Recipes ----------
export const ingredients = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  unit: text("unit").notNull().default("pcs"), // pcs | g | ml
  stockQty: doublePrecision("stock_qty").notNull().default(0),
  minStock: doublePrecision("min_stock").notNull().default(0),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
});

export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().unique().references(() => products.id, { onDelete: "cascade" }),
  notes: text("notes").notNull().default(""),
});

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  quantity: doublePrecision("quantity").notNull(),
}, (t) => [uniqueIndex("recipe_ingredient_unique").on(t.recipeId, t.ingredientId)]);

export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  type: text("type").notNull(), // purchase | consumption | adjustment | waste | refund_restore
  quantity: doublePrecision("quantity").notNull(), // always positive; direction derived from type
  unitCostCents: integer("unit_cost_cents"),
  referenceType: text("reference_type"), // order | purchase_order | manual | reset
  referenceId: integer("reference_id"),
  source: text("source").notNull().default("manual"), // manual | simulation
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("stock_movements_ingredient_idx").on(t.ingredientId), index("stock_movements_ref_idx").on(t.referenceType, t.referenceId)]);

// ---------- Suppliers / Purchasing ----------
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  active: boolean("active").notNull().default(true),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  status: text("status").notNull().default("draft"), // draft | approved | partially_received | received | cancelled
  totalCostCents: integer("total_cost_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  quantity: doublePrecision("quantity").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  receivedQty: doublePrecision("received_qty").notNull().default(0),
});

// ---------- Customers / Reservations ----------
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  segment: text("segment").notNull().default("new"), // new | regular | vip
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  totalSpentCents: integer("total_spent_cents").notNull().default(0),
  visits: integer("visits").notNull().default(0),
  isVirtual: boolean("is_virtual").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reservations = pgTable("reservations", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: text("customer_name").notNull().default(""),
  tableId: integer("table_id").notNull().references(() => restaurantTables.id),
  reservedFor: timestamp("reserved_for", { withTimezone: true }).notNull(),
  partySize: integer("party_size").notNull().default(2),
  status: text("status").notNull().default("booked"), // booked | seated | completed | cancelled | no_show
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("reservations_table_time_idx").on(t.tableId, t.reservedFor)]);

// ---------- Employees ----------
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: text("position").notNull(),
  department: text("department").notNull().default("Operations"),
  roleId: integer("role_id").references(() => roles.id),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(1500),
  status: text("status").notNull().default("active"), // active | on_break | off_duty
  isVirtual: boolean("is_virtual").notNull().default(true),
  hiredAt: timestamp("hired_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  workDate: text("work_date").notNull(), // YYYY-MM-DD
  checkIn: timestamp("check_in", { withTimezone: true }),
  checkOut: timestamp("check_out", { withTimezone: true }),
  status: text("status").notNull().default("present"), // present | late | absent
  source: text("source").notNull().default("manual"), // manual | simulation
}, (t) => [uniqueIndex("attendance_emp_date").on(t.employeeId, t.workDate)]);

// ---------- Orders / Payments ----------
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  type: text("type").notNull().default("dine_in"), // dine_in | takeaway | delivery
  status: text("status").notNull().default("pending"), // pending | confirmed | preparing | ready | served | completed | cancelled
  tableId: integer("table_id").references(() => restaurantTables.id),
  customerId: integer("customer_id").references(() => customers.id),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  cogsCents: integer("cogs_cents").notNull().default(0),
  inventoryDeducted: boolean("inventory_deducted").notNull().default(false),
  source: text("source").notNull().default("manual"), // manual | simulation
  simulationSessionId: integer("simulation_session_id"),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("orders_status_idx").on(t.status), index("orders_created_idx").on(t.createdAt)]);

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => products.id),
  productName: text("product_name").notNull(), // snapshot for historical integrity
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(), // snapshot incl. modifiers per unit
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  modifiers: jsonb("modifiers").$type<{ name: string; priceDeltaCents: number }[]>().notNull().default([]),
  instructions: text("instructions").notNull().default(""),
}, (t) => [index("order_items_order_idx").on(t.orderId)]);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().unique().references(() => orders.id), // one settled payment per order (idempotency)
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull().default("cash"), // cash | card | mobile
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refunds = pgTable("refunds", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull().default(""),
  inventoryRestored: boolean("inventory_restored").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  category: text("category").notNull().default("general"), // rent | utilities | payroll | marketing | equipment | general
  description: text("description").notNull().default(""),
  amountCents: integer("amount_cents").notNull(),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Simulation ----------
export const simulationSessions = pgTable("simulation_sessions", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull().default("automatic"), // assisted | automatic | stress
  status: text("status").notNull().default("running"), // running | paused | stopped | completed
  speed: doublePrecision("speed").notNull().default(1),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const simulationEvents = pgTable("simulation_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("simulation_session_id"),
  eventType: text("event_type").notNull().default("info"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sim_events_created_idx").on(t.createdAt)]);

// ---------- System ----------
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name").notNull().default("system"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});
