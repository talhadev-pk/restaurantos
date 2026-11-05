// CLI: `npx tsx src/db/seed.ts` — wipes and reseeds the local SQLite database.
// The server auto-seeds on first boot; this script is for a manual fresh start.
import "dotenv/config";
import { sqliteClient, dbReady } from "./index";
import { runSeed } from "./seed-core";

const TABLES = [
  "sessions", "audit_logs", "simulation_events", "simulation_sessions",
  "refunds", "payments", "order_items", "orders", "attendance", "employees",
  "reservations", "customers", "purchase_order_items", "purchase_orders", "suppliers",
  "stock_movements", "recipe_ingredients", "recipes", "ingredients",
  "product_modifiers", "products", "categories", "restaurant_tables",
  "branches", "expenses", "users", "roles", "settings",
];

async function main() {
  await dbReady;
  console.log("Resetting local database…");
  await sqliteClient.execute("PRAGMA foreign_keys=OFF");
  for (const t of TABLES) {
    await sqliteClient.execute(`DELETE FROM ${t}`);
    await sqliteClient.execute(`DELETE FROM sqlite_sequence WHERE name = '${t}'`).catch(() => {});
  }
  await sqliteClient.execute("PRAGMA foreign_keys=ON");
  await runSeed();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
