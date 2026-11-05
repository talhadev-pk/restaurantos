import {
  sqliteTable, integer, real, text, uniqueIndex, index,
} from "drizzle-orm/sqlite-core";

// Timestamps are integer milliseconds (Date-typed); NOW columns default at insert time.
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const tsNow = (name: string) => integer(name, { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());
const bool = (name: string) => integer(name, { mode: "boolean" });
const boolTrue = (name: string) => integer(name, { mode: "boolean" }).notNull().default(true);

// ---------- Auth / RBAC ----------
export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  permissions: text("permissions", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
  createdAt: tsNow("created_at"),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  roleId: integer("role_id").notNull().references(() => roles.id),
  active: boolTrue("active"),
  createdAt: tsNow("created_at"),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: tsNow("created_at"),
  expiresAt: ts("expires_at").notNull(),
});

export const branches = sqliteTable("branches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  createdAt: tsNow("created_at"),
});

// ---------- Floor ----------
export const restaurantTables = sqliteTable("restaurant_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  capacity: integer("capacity").notNull().default(2),
  status: text("status").notNull().default("available"), // available | occupied | reserved | cleaning
  note: text("note").notNull().default(""),
  posX: integer("pos_x").notNull().default(0),
  posY: integer("pos_y").notNull().default(0),
  branchId: integer("branch_id").references(() => branches.id),
  active: boolTrue("active"),
}, (t) => [index("tables_status_idx").on(t.status)]);

// ---------- Menu ----------
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolTrue("active"),
});

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").references(() => categories.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  taxRateBp: integer("tax_rate_bp").notNull().default(850), // basis points, 850 = 8.5%
  sku: text("sku"),
  color: text("color").notNull().default("amber"),
  available: boolTrue("available"),
  branchId: integer("branch_id").references(() => branches.id),
  createdAt: tsNow("created_at"),
  updatedAt: tsNow("updated_at"),
}, (t) => [index("products_category_idx").on(t.categoryId)]);

export const productModifiers = sqliteTable("product_modifiers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priceDeltaCents: integer("price_delta_cents").notNull().default(0),
});

// ---------- Inventory & Recipes ----------
export const ingredients = sqliteTable("ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  unit: text("unit").notNull().default("pcs"), // pcs | g | ml
  stockQty: real("stock_qty").notNull().default(0),
  minStock: real("min_stock").notNull().default(0),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  expiresAt: ts("expires_at"),
  active: boolTrue("active"),
});

export const recipes = sqliteTable("recipes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull().unique().references(() => products.id, { onDelete: "cascade" }),
  notes: text("notes").notNull().default(""),
});

export const recipeIngredients = sqliteTable("recipe_ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipeId: integer("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  quantity: real("quantity").notNull(),
}, (t) => [uniqueIndex("recipe_ingredient_unique").on(t.recipeId, t.ingredientId)]);

export const stockMovements = sqliteTable("stock_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  type: text("type").notNull(), // purchase | consumption | adjustment | waste | refund_restore
  quantity: real("quantity").notNull(), // always positive; direction derived from type
  unitCostCents: integer("unit_cost_cents"),
  referenceType: text("reference_type"), // order | purchase_order | manual | reset
  referenceId: integer("reference_id"),
  source: text("source").notNull().default("manual"), // manual | simulation
  note: text("note").notNull().default(""),
  createdAt: tsNow("created_at"),
}, (t) => [index("stock_movements_ingredient_idx").on(t.ingredientId), index("stock_movements_ref_idx").on(t.referenceType, t.referenceId)]);

// ---------- Suppliers / Purchasing ----------
export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  active: boolTrue("active"),
});

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  status: text("status").notNull().default("draft"), // draft | approved | partially_received | received | cancelled
  totalCostCents: integer("total_cost_cents").notNull().default(0),
  createdAt: tsNow("created_at"),
  receivedAt: ts("received_at"),
});

export const purchaseOrderItems = sqliteTable("purchase_order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id),
  quantity: real("quantity").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  receivedQty: real("received_qty").notNull().default(0),
});

// ---------- Customers / Reservations ----------
export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  segment: text("segment").notNull().default("new"), // new | regular | vip
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  totalSpentCents: integer("total_spent_cents").notNull().default(0),
  visits: integer("visits").notNull().default(0),
  isVirtual: bool("is_virtual").notNull().default(false),
  createdAt: tsNow("created_at"),
});

export const reservations = sqliteTable("reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: text("customer_name").notNull().default(""),
  tableId: integer("table_id").notNull().references(() => restaurantTables.id),
  reservedFor: ts("reserved_for").notNull(),
  partySize: integer("party_size").notNull().default(2),
  status: text("status").notNull().default("booked"), // booked | seated | completed | cancelled | no_show
  notes: text("notes").notNull().default(""),
  createdAt: tsNow("created_at"),
}, (t) => [index("reservations_table_time_idx").on(t.tableId, t.reservedFor)]);

// ---------- Employees ----------
export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  position: text("position").notNull(),
  department: text("department").notNull().default("Operations"),
  roleId: integer("role_id").references(() => roles.id),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(1500),
  status: text("status").notNull().default("active"), // active | on_break | off_duty
  isVirtual: boolTrue("is_virtual"),
  hiredAt: tsNow("hired_at"),
});

export const attendance = sqliteTable("attendance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  workDate: text("work_date").notNull(), // YYYY-MM-DD
  checkIn: ts("check_in"),
  checkOut: ts("check_out"),
  status: text("status").notNull().default("present"), // present | late | absent
  source: text("source").notNull().default("manual"), // manual | simulation
}, (t) => [uniqueIndex("attendance_emp_date").on(t.employeeId, t.workDate)]);

// ---------- Orders / Payments ----------
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  inventoryDeducted: bool("inventory_deducted").notNull().default(false),
  source: text("source").notNull().default("manual"), // manual | simulation
  simulationSessionId: integer("simulation_session_id"),
  notes: text("notes").notNull().default(""),
  createdAt: tsNow("created_at"),
  updatedAt: tsNow("updated_at"),
  completedAt: ts("completed_at"),
}, (t) => [index("orders_status_idx").on(t.status), index("orders_created_idx").on(t.createdAt)]);

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => products.id),
  productName: text("product_name").notNull(), // snapshot for historical integrity
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(), // snapshot incl. modifiers per unit
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  modifiers: text("modifiers", { mode: "json" }).$type<{ name: string; priceDeltaCents: number }[]>().notNull().$defaultFn(() => []),
  instructions: text("instructions").notNull().default(""),
}, (t) => [index("order_items_order_idx").on(t.orderId)]);

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().unique().references(() => orders.id), // one settled payment per order (idempotency)
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull().default("cash"), // cash | card | mobile
  createdAt: tsNow("created_at"),
});

export const refunds = sqliteTable("refunds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull().default(""),
  inventoryRestored: bool("inventory_restored").notNull().default(false),
  createdAt: tsNow("created_at"),
});

export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull().default("general"), // rent | utilities | payroll | marketing | equipment | general
  description: text("description").notNull().default(""),
  amountCents: integer("amount_cents").notNull(),
  incurredAt: tsNow("incurred_at"),
  createdAt: tsNow("created_at"),
});

// ---------- Simulation ----------
export const simulationSessions = sqliteTable("simulation_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mode: text("mode").notNull().default("automatic"), // assisted | automatic | stress
  status: text("status").notNull().default("running"), // running | paused | stopped | completed
  speed: real("speed").notNull().default(1),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  startedAt: tsNow("started_at"),
  endedAt: ts("ended_at"),
});

export const simulationEvents = sqliteTable("simulation_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("simulation_session_id"),
  eventType: text("event_type").notNull().default("info"),
  message: text("message").notNull(),
  createdAt: tsNow("created_at"),
}, (t) => [index("sim_events_created_idx").on(t.createdAt)]);

// ---------- System ----------
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  userName: text("user_name").notNull().default("system"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  createdAt: tsNow("created_at"),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});
