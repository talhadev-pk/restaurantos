// RestaurantOS browser database — Dexie (IndexedDB) layer.
// Everything lives in the visitor's browser. No server, no cloud.
import Dexie, { type Table } from "dexie";

export const nowIso = () => new Date().toISOString();

export class RestaurantOSDB extends Dexie {
  restaurants!: Table<any, number>;
  branches!: Table<any, number>;
  roles!: Table<any, number>;
  users!: Table<any, number>;
  categories!: Table<any, number>;
  products!: Table<any, number>;
  modifiers!: Table<any, number>;
  ingredients!: Table<any, number>;
  recipes!: Table<any, number>;
  recipeIngredients!: Table<any, number>;
  stockMovements!: Table<any, number>;
  suppliers!: Table<any, number>;
  purchaseOrders!: Table<any, number>;
  purchaseOrderItems!: Table<any, number>;
  customers!: Table<any, number>;
  reservations!: Table<any, number>;
  restaurantTables!: Table<any, number>;
  employees!: Table<any, number>;
  shifts!: Table<any, number>;
  attendance!: Table<any, number>;
  orders!: Table<any, number>;
  orderItems!: Table<any, number>;
  payments!: Table<any, number>;
  refunds!: Table<any, number>;
  expenses!: Table<any, number>;
  taxes!: Table<any, number>;
  simSessions!: Table<any, number>;
  simEvents!: Table<any, number>;
  auditLogs!: Table<any, number>;

  constructor(dbName = "restaurantos") {
    super(dbName);
    this.version(1).stores({
      restaurants: "++id, name",
      branches: "++id, code",
      roles: "++id, &name",
      users: "++id, &email",
      categories: "++id, &name",
      products: "++id, name, categoryId, available",
      modifiers: "++id, productId",
      ingredients: "++id, &name",
      recipes: "++id, &productId",
      recipeIngredients: "++id, recipeId, ingredientId, [recipeId+ingredientId]",
      stockMovements: "++id, ingredientId, type, createdAt, [referenceType+referenceId]",
      suppliers: "++id, &name",
      purchaseOrders: "++id, supplierId, status, createdAt",
      purchaseOrderItems: "++id, orderId, ingredientId",
      customers: "++id, name, totalSpentCents",
      reservations: "++id, tableId, reservedFor, status",
      restaurantTables: "++id, &name, status",
      employees: "++id, name, status",
      shifts: "++id, employeeId, workDate",
      attendance: "++id, employeeId, workDate, [employeeId+workDate]",
      orders: "++id, &orderNumber, status, type, createdAt, completedAt, source, customerId, tableId, simulationSessionId",
      orderItems: "++id, orderId, productId",
      payments: "++id, &orderId, createdAt",
      refunds: "++id, orderId, createdAt",
      expenses: "++id, category, incurredAt",
      taxes: "++id, rateBp",
      simSessions: "++id, status, startedAt",
      simEvents: "++id, sessionId, createdAt",
      auditLogs: "++id, action, entity, createdAt",
    });
  }
}

export const db = new RestaurantOSDB();

// ---------- settings (LocalStorage for lightweight prefs + mirrored in backup) ----------
const SETTINGS_KEY = "ros_settings";
export const DEFAULT_SETTINGS: Record<string, string> = {
  displayName: "Talha",
  ownerEmail: "talhamalikawan@example.com",
  restaurantName: "Ember & Oak Bistro",
  currencySymbol: "$",
  allowNegativeStock: "false",
};

export function getSettings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function getSetting(key: string): string {
  return getSettings()[key] ?? DEFAULT_SETTINGS[key] ?? "";
}
export function saveSettings(patch: Record<string, string>) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getSettings(), ...patch }));
}

export const SESSION_KEY = "ros_session_email";

// ---------- backup / restore ----------
export const BACKUP_MAGIC = "restaurantos-backup";
export const BACKUP_VERSION = 1;

const ALL_TABLES = [
  "restaurants", "branches", "roles", "users", "categories", "products", "modifiers",
  "ingredients", "recipes", "recipeIngredients", "stockMovements", "suppliers",
  "purchaseOrders", "purchaseOrderItems", "customers", "reservations", "restaurantTables",
  "employees", "shifts", "attendance", "orders", "orderItems", "payments", "refunds",
  "expenses", "taxes", "simSessions", "simEvents", "auditLogs",
] as const;

export async function exportBackup() {
  const data: Record<string, unknown[]> = {};
  for (const t of ALL_TABLES) data[t] = await (db as any)[t].toArray();
  return {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    settings: getSettings(),
    tableCounts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
}

export function validateBackup(payload: any): { valid: true; summary: string } | { valid: false; error: string } {
  if (!payload || typeof payload !== "object") return { valid: false, error: "File is not a JSON object." };
  if (payload.magic !== BACKUP_MAGIC) return { valid: false, error: "This is not a RestaurantOS backup file." };
  if (typeof payload.version !== "number" || payload.version > BACKUP_VERSION) {
    return { valid: false, error: `Backup schema v${payload.version} is newer than this app (v${BACKUP_VERSION}). Update the app first.` };
  }
  if (!payload.data || typeof payload.data !== "object") return { valid: false, error: "Backup contains no data tables." };
  const missing = ALL_TABLES.filter((t) => !Array.isArray(payload.data[t]));
  if (missing.length) return { valid: false, error: `Backup is missing tables: ${missing.slice(0, 3).join(", ")}…` };
  const counts = ALL_TABLES.map((t) => payload.data[t].length).reduce((a: number, b: number) => a + b, 0);
  return { valid: true, summary: `${counts.toLocaleString()} records across ${ALL_TABLES.length} tables, exported ${new Date(payload.exportedAt).toLocaleString()}` };
}

/** Imports a validated backup atomically. Keeps existing data unless mode=replace. */
export async function importBackup(payload: any, mode: "replace" | "merge" = "replace") {
  const check = validateBackup(payload);
  if (!check.valid) throw new Error(check.error);
  await db.transaction("rw", db.tables, async () => {
    for (const t of ALL_TABLES) {
      const table = (db as any)[t] as Table<any, number>;
      if (mode === "replace") await table.clear();
      await table.bulkAdd(payload.data[t]);
    }
  });
  if (payload.settings) saveSettings(payload.settings);
}

export async function clearAllData(keepSettings = false) {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  if (!keepSettings) localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export async function tableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ALL_TABLES) out[t] = await (db as any)[t].count();
  return out;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator?.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator?.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
