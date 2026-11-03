import "dotenv/config";
import { db } from "./index";
import * as s from "./schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword, ALL_PERMISSIONS } from "../lib/auth";
import { DEFAULT_SETTINGS } from "../lib/system";
import { createOrder, transitionOrder } from "../lib/services/orders";

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  const existing = await db.select().from(s.users).limit(1);
  if (existing.length) {
    console.log("Database already seeded — skipping.");
    return;
  }
  console.log("Seeding RestaurantOS…");

  // Roles
  const roleDefs = [
    { name: "Administrator", permissions: ["*"] },
    { name: "Manager", permissions: ALL_PERMISSIONS.filter((p) => p !== "settings.edit") as string[] },
    { name: "Cashier", permissions: ["dashboard.view", "pos.use", "customers.manage", "reservations.manage"] },
    { name: "Kitchen Staff", permissions: ["kitchen.use"] },
    { name: "Inventory Manager", permissions: ["dashboard.view", "inventory.manage", "purchasing.manage", "reports.view"] },
    { name: "Accountant", permissions: ["dashboard.view", "finance.manage", "reports.view"] },
  ];
  for (const r of roleDefs) await db.insert(s.roles).values(r).onConflictDoNothing();
  const roles = await db.select().from(s.roles);
  const roleId = (name: string) => roles.find((r) => r.name === name)!.id;

  // Settings
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(s.settings).values({ key, value }).onConflictDoNothing();
  }

  // User + branch
  await db.insert(s.users).values({
    name: "Talha",
    email: "talhamalikawan@example.com",
    passwordHash: hashPassword("demo1234"),
    roleId: roleId("Administrator"),
  });
  const [branch] = await db.insert(s.branches).values({ name: "Downtown", code: "DT-01" }).returning();

  // Tables
  const tableDefs = [
    { name: "T-01", capacity: 2, posX: 6, posY: 8 }, { name: "T-02", capacity: 2, posX: 50, posY: 8 },
    { name: "T-03", capacity: 4, posX: 82, posY: 12 }, { name: "T-04", capacity: 4, posX: 10, posY: 52 },
    { name: "T-05", capacity: 6, posX: 44, posY: 48 }, { name: "T-06", capacity: 4, posX: 80, posY: 55 },
    { name: "T-07", capacity: 2, posX: 16, posY: 84 }, { name: "T-08", capacity: 8, posX: 60, posY: 84 },
  ];
  for (const t of tableDefs) await db.insert(s.restaurantTables).values({ ...t, branchId: branch.id });

  // Categories
  const catDefs = ["Starters", "Burgers & Mains", "Pizza", "Salads & Bowls", "Desserts", "Beverages"];
  const catIds: Record<string, number> = {};
  for (let i = 0; i < catDefs.length; i++) {
    const [c] = await db.insert(s.categories).values({ name: catDefs[i], sortOrder: i }).returning();
    catIds[catDefs[i]] = c.id;
  }

  // Ingredients (name, unit, cost cents per unit, stock, minStock)
  const ingDefs: [string, string, number, number, number][] = [
    ["Burger Bun", "pcs", 40, 320, 40], ["Beef Patty", "pcs", 180, 260, 30], ["Cheese Slice", "pcs", 35, 300, 40],
    ["Lettuce", "g", 2, 4000, 500], ["Tomato", "g", 1, 5000, 600], ["Special Sauce", "g", 3, 2000, 300],
    ["Bacon Strip", "pcs", 60, 180, 24], ["BBQ Sauce", "g", 4, 1600, 250],
    ["Pizza Dough Ball", "pcs", 90, 150, 20], ["Mozzarella", "g", 2, 8000, 1000], ["Pepperoni", "g", 5, 2500, 300],
    ["Mushroom", "g", 3, 2400, 300], ["Truffle Oil", "ml", 12, 500, 60], ["Tomato Sauce", "g", 2, 5000, 600], ["Fresh Basil", "g", 2, 800, 100],
    ["Salmon Fillet", "pcs", 520, 40, 6], ["Asparagus", "g", 3, 2000, 250], ["Lemon", "pcs", 25, 90, 12], ["Butter", "g", 4, 2500, 300],
    ["Ribeye Cut", "pcs", 980, 30, 5], ["Chicken Breast", "pcs", 240, 80, 10], ["Pasta", "g", 2, 6000, 800],
    ["Cream", "ml", 6, 3000, 400], ["Parmesan", "g", 8, 1500, 150], ["Romaine Lettuce", "g", 2, 2500, 300],
    ["Croutons", "g", 3, 900, 100], ["Caesar Dressing", "ml", 8, 1200, 150], ["Quinoa", "g", 4, 3000, 400],
    ["Avocado", "pcs", 110, 60, 8], ["Chickpeas", "g", 2, 2400, 300],
    ["Mascarpone", "g", 6, 1800, 200], ["Ladyfingers", "pcs", 20, 200, 24], ["Espresso Shot", "ml", 3, 2400, 300],
    ["Flour", "g", 1, 6000, 800], ["Sugar", "g", 1, 5000, 600], ["Dark Chocolate", "g", 5, 1800, 200], ["Egg", "pcs", 18, 240, 30],
    ["Milk", "ml", 2, 6000, 800], ["Coffee Beans", "g", 15, 1500, 200],
    ["Mint Leaves", "g", 2, 500, 60], ["Sparkling Water", "ml", 1, 6000, 1000], ["Cola Syrup", "ml", 4, 1600, 200],
    ["Calamari Rings", "g", 8, 1600, 200], ["Garlic Aioli", "ml", 10, 900, 120], ["Sourdough Slice", "pcs", 30, 140, 18],
    ["Onion", "g", 1, 3000, 400], ["Olive Oil", "ml", 3, 1500, 200], ["Seasonal Vegetables", "g", 2, 2500, 300],
  ];
  const ingIds: Record<string, number> = {};
  for (const [name, unit, cost, stock, min] of ingDefs) {
    const scaledCost = Math.max(1, Math.round(cost * 0.6)); // realistic ~30% food-cost economics
    const scaledStock = Math.round(stock * 1.6);
    const [ing] = await db
      .insert(s.ingredients)
      .values({ name, unit, unitCostCents: scaledCost, stockQty: scaledStock, minStock: min })
      .returning();
    ingIds[name] = ing.id;
    await db.insert(s.stockMovements).values({
      ingredientId: ing.id, type: "adjustment", quantity: scaledStock, unitCostCents: scaledCost,
      referenceType: "manual", note: "Opening stock (seed)",
    });
  }

  // Products (name, category, priceCents, taxBp, color, description)
  const prodDefs: [string, string, number, number, string, string][] = [
    ["Crispy Calamari", "Starters", 895, 850, "amber", "Golden fried calamari with garlic aioli"],
    ["Bruschetta Board", "Starters", 725, 850, "rose", "Toasted sourdough, tomato, basil, olive oil"],
    ["Classic Burger", "Burgers & Mains", 1295, 850, "amber", "Beef patty, cheddar, lettuce, tomato, house sauce"],
    ["Smoked BBQ Burger", "Burgers & Mains", 1495, 850, "rose", "Beef patty, bacon, BBQ glaze, crispy onion"],
    ["Grilled Salmon", "Burgers & Mains", 1895, 850, "sky", "Salmon fillet, asparagus, lemon butter"],
    ["Ribeye Steak", "Burgers & Mains", 2495, 850, "rose", "280g ribeye, herb butter, seasonal vegetables"],
    ["Chicken Alfredo Pasta", "Burgers & Mains", 1595, 850, "violet", "Creamy alfredo, parmesan, grilled chicken"],
    ["Margherita Pizza", "Pizza", 1095, 850, "lime", "Tomato, mozzarella, fresh basil"],
    ["Pepperoni Pizza", "Pizza", 1295, 850, "rose", "Loaded pepperoni and mozzarella"],
    ["Truffle Mushroom Pizza", "Pizza", 1495, 850, "violet", "Wild mushrooms, truffle oil, mozzarella"],
    ["Caesar Salad", "Salads & Bowls", 895, 850, "emerald", "Romaine, croutons, parmesan, caesar dressing"],
    ["Buddha Bowl", "Salads & Bowls", 1095, 850, "emerald", "Quinoa, avocado, chickpeas, vegetables"],
    ["Tiramisu", "Desserts", 695, 850, "amber", "Classic espresso-soaked tiramisu"],
    ["Chocolate Lava Cake", "Desserts", 795, 850, "rose", "Molten dark chocolate center"],
    ["Fresh Lemonade", "Beverages", 395, 425, "lime", "Freshly squeezed with mint"],
    ["Cappuccino", "Beverages", 450, 425, "amber", "Double shot espresso, steamed milk"],
    ["Craft Cola", "Beverages", 350, 425, "sky", "House-crafted sparkling cola"],
  ];
  const prodIds: Record<string, number> = {};
  for (const [name, cat, price, tax, color, desc] of prodDefs) {
    const [p] = await db.insert(s.products).values({
      name, categoryId: catIds[cat], priceCents: price, taxRateBp: tax, color, description: desc,
    }).returning();
    prodIds[name] = p.id;
  }

  // Modifiers
  const modDefs: [string, string, number][] = [
    ["Classic Burger", "Extra Cheese", 120], ["Classic Burger", "Add Bacon", 180], ["Classic Burger", "Gluten-free Bun", 90],
    ["Smoked BBQ Burger", "Extra Cheese", 120], ["Smoked BBQ Burger", "Add Bacon", 180],
    ["Margherita Pizza", "Extra Mozzarella", 150], ["Pepperoni Pizza", "Extra Mozzarella", 150],
    ["Truffle Mushroom Pizza", "Extra Mozzarella", 150],
    ["Cappuccino", "Large", 100], ["Fresh Lemonade", "Large", 100], ["Craft Cola", "Large", 100],
  ];
  for (const [prod, name, delta] of modDefs) {
    await db.insert(s.productModifiers).values({ productId: prodIds[prod], name, priceDeltaCents: delta });
  }

  // Recipes
  const recipeDefs: Record<string, [string, number][]> = {
    "Crispy Calamari": [["Calamari Rings", 150], ["Garlic Aioli", 40], ["Olive Oil", 15]],
    "Bruschetta Board": [["Sourdough Slice", 3], ["Tomato", 80], ["Fresh Basil", 5], ["Olive Oil", 12]],
    "Classic Burger": [["Burger Bun", 1], ["Beef Patty", 1], ["Cheese Slice", 1], ["Lettuce", 20], ["Tomato", 30], ["Special Sauce", 15]],
    "Smoked BBQ Burger": [["Burger Bun", 1], ["Beef Patty", 1], ["Cheese Slice", 1], ["Bacon Strip", 2], ["BBQ Sauce", 20], ["Onion", 25]],
    "Grilled Salmon": [["Salmon Fillet", 1], ["Asparagus", 100], ["Lemon", 1], ["Butter", 20]],
    "Ribeye Steak": [["Ribeye Cut", 1], ["Butter", 15], ["Seasonal Vegetables", 120]],
    "Chicken Alfredo Pasta": [["Pasta", 180], ["Chicken Breast", 1], ["Cream", 120], ["Parmesan", 20], ["Butter", 15]],
    "Margherita Pizza": [["Pizza Dough Ball", 1], ["Tomato Sauce", 90], ["Mozzarella", 120], ["Fresh Basil", 6]],
    "Pepperoni Pizza": [["Pizza Dough Ball", 1], ["Tomato Sauce", 90], ["Mozzarella", 130], ["Pepperoni", 60]],
    "Truffle Mushroom Pizza": [["Pizza Dough Ball", 1], ["Mozzarella", 120], ["Mushroom", 90], ["Truffle Oil", 8]],
    "Caesar Salad": [["Romaine Lettuce", 120], ["Croutons", 30], ["Parmesan", 15], ["Caesar Dressing", 45]],
    "Buddha Bowl": [["Quinoa", 90], ["Avocado", 1], ["Chickpeas", 80], ["Seasonal Vegetables", 100], ["Olive Oil", 10]],
    "Tiramisu": [["Mascarpone", 90], ["Ladyfingers", 6], ["Espresso Shot", 40], ["Sugar", 20], ["Egg", 1]],
    "Chocolate Lava Cake": [["Dark Chocolate", 60], ["Flour", 40], ["Sugar", 35], ["Butter", 30], ["Egg", 2]],
    "Fresh Lemonade": [["Lemon", 1], ["Sparkling Water", 250], ["Sugar", 15], ["Mint Leaves", 4]],
    "Cappuccino": [["Coffee Beans", 16], ["Milk", 180]],
    "Craft Cola": [["Cola Syrup", 45], ["Sparkling Water", 300]],
  };
  for (const [prod, lines] of Object.entries(recipeDefs)) {
    const [rec] = await db.insert(s.recipes).values({ productId: prodIds[prod] }).returning();
    await db.insert(s.recipeIngredients).values(
      lines.map(([ing, qty]) => ({ recipeId: rec.id, ingredientId: ingIds[ing], quantity: qty })),
    );
  }

  // Suppliers
  const supplierDefs = [
    { name: "Prime Foods Distribution", contactName: "Marcus Hale", email: "orders@primefoods.example", phone: "+1-555-0182" },
    { name: "FreshFarm Produce Co.", contactName: "Elena Torres", email: "sales@freshfarm.example", phone: "+1-555-0147" },
    { name: "Metro Beverage Supply", contactName: "Rajesh Iyer", email: "hello@metrobev.example", phone: "+1-555-0119" },
  ];
  for (const sup of supplierDefs) await db.insert(s.suppliers).values(sup);

  // Employees (virtual entities)
  const empDefs = [
    { name: "Amara Osei", position: "General Manager", department: "Management", role: "Manager", rate: 2800 },
    { name: "Diego Ramos", position: "Head Chef", department: "Kitchen", role: "Kitchen Staff", rate: 2400 },
    { name: "Sofia Lindqvist", position: "Sous Chef", department: "Kitchen", role: "Kitchen Staff", rate: 2100 },
    { name: "Priya Nair", position: "Cashier", department: "Front of House", role: "Cashier", rate: 1600 },
    { name: "Jonas Weber", position: "Inventory Manager", department: "Operations", role: "Inventory Manager", rate: 1900 },
    { name: "Fatima Sy", position: "Accountant", department: "Finance", role: "Accountant", rate: 2300 },
  ];
  for (const e of empDefs) {
    await db.insert(s.employees).values({
      name: e.name, position: e.position, department: e.department,
      roleId: roleId(e.role), hourlyRateCents: e.rate, isVirtual: true,
    });
  }

  // Customers (fictional)
  const custDefs = [
    ["Hannah Brooks", "+1-555-0141"], ["Yuki Tanaka", "+1-555-0177"], ["Gabriel Moreau", "+1-555-0158"],
    ["Amelia Clarke", "+1-555-0133"], ["Dmitri Petrov", "+1-555-0195"], ["Chloe Dubois", "+1-555-0121"],
    ["Marcus Reid", "+1-555-0168"], ["Ingrid Johansson", "+1-555-0189"],
  ];
  for (const [name, phone] of custDefs) {
    await db.insert(s.customers).values({ name, phone, email: `${name.split(" ")[0].toLowerCase()}@example.com`, isVirtual: true });
  }

  // Expenses (spread over the last 30 days)
  const expDefs: [string, string, number, number][] = [
    ["rent", "Monthly rent — Downtown premises", 95000, 26],
    ["utilities", "Electricity & water bill", 16800, 19],
    ["payroll", "Payroll — week 1 & 2", 41000, 14],
    ["payroll", "Payroll — week 3 & 4", 42400, 3],
    ["marketing", "Social media campaign", 5400, 11],
    ["equipment", "Replacement blender & pans", 3800, 7],
    ["general", "Cleaning & linen service", 2600, 5],
  ];
  for (const [category, description, amount, daysAgo] of expDefs) {
    await db.insert(s.expenses).values({
      category, description, amountCents: amount,
      incurredAt: new Date(Date.now() - daysAgo * 86400000),
    });
  }

  // Historical orders through the REAL order service (manual source = demo walkthroughs)
  const customers = await db.select().from(s.customers);
  const prodList = Object.values(prodIds);
  let created = 0;
  for (let daysAgo = 13; daysAgo >= 1; daysAgo--) {
    const count = rand(9, 15);
    for (let i = 0; i < count; i++) {
      const isDineIn = Math.random() < 0.4;
      const freeTables = await db.select().from(s.restaurantTables).where(eq(s.restaurantTables.status, "available"));
      const table = isDineIn && freeTables.length ? pick(freeTables) : null;
      const items = Array.from({ length: rand(1, 3) }, () => ({ productId: pick(prodList), quantity: rand(1, 2) }));
      try {
        const order = await createOrder(null, {
          type: isDineIn && table ? "dine_in" : pick(["takeaway", "delivery"]),
          tableId: table?.id ?? null,
          customerId: pick(customers).id,
          items,
          autoConfirm: true,
        });
        await transitionOrder(null, order.id, "start_prepare");
        await transitionOrder(null, order.id, "ready");
        try {
          await transitionOrder(null, order.id, "complete", { paymentMethod: pick(["cash", "card", "card", "mobile"]) });
        } catch {
          // stock exhausted late in the run — cancel cleanly so no stuck pipeline rows
          await transitionOrder(null, order.id, "cancel");
          continue;
        }
        const when = new Date(Date.now() - daysAgo * 86400000 - rand(1, 8) * 3600000 + 12 * 3600000);
        await db.update(s.orders).set({ createdAt: when, completedAt: when, updatedAt: when }).where(eq(s.orders.id, order.id));
        await db.execute(sql`UPDATE payments SET created_at = ${when} WHERE order_id = ${order.id}`);
        await db.update(s.restaurantTables).set({ status: "available" }).where(eq(s.restaurantTables.status, "cleaning"));
        created++;
      } catch (e) {
        console.warn("historical order skipped:", (e as Error).message);
      }
    }
  }

  // Low-stock demo: draw down two ingredients, recorded as audited stocktake adjustments
  for (const [name, target] of [["Salmon Fillet", 4], ["Ribeye Cut", 2]] as const) {
    const [ing] = await db.select().from(s.ingredients).where(eq(s.ingredients.name, name));
    if (ing && ing.stockQty > target) {
      const diff = Math.round((ing.stockQty - target) * 1000) / 1000;
      await db.update(s.ingredients).set({ stockQty: target }).where(eq(s.ingredients.id, ing.id));
      await db.insert(s.stockMovements).values({
        ingredientId: ing.id, type: "adjustment", quantity: diff, unitCostCents: ing.unitCostCents,
        referenceType: "manual", note: `-${diff} ${ing.unit} — Stocktake write-down (seed)`,
      });
    }
  }

  console.log(`Seed complete. Created ${created} historical completed orders.`);
  console.log("Login: talhamalikawan@example.com / demo1234");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
