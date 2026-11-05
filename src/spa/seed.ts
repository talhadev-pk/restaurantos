// One-time demo seed per browser profile. Historical orders flow through the
// REAL createOrder/transitionOrder services — no fake numbers.
import { db, nowIso } from "./db";
import { ALL_PERMISSIONS, createOrder, hashPassword, transitionOrder } from "./services";

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const iso = (ms: number) => new Date(ms).toISOString();

export async function seedIfEmpty(): Promise<boolean> {
  if ((await db.users.count()) > 0) return false;
  console.info("[spa] fresh browser profile — seeding demo restaurant…");

  // Roles
  const roleDefs = [
    { name: "Administrator", permissions: ["*"] },
    { name: "Manager", permissions: ALL_PERMISSIONS.filter((p) => p !== "settings.edit") },
    { name: "Cashier", permissions: ["dashboard.view", "pos.use", "customers.manage", "reservations.manage"] },
    { name: "Kitchen Staff", permissions: ["kitchen.use"] },
    { name: "Inventory Manager", permissions: ["dashboard.view", "inventory.manage", "purchasing.manage", "reports.view"] },
    { name: "Accountant", permissions: ["dashboard.view", "finance.manage", "reports.view"] },
  ];
  for (const r of roleDefs) await db.roles.add(r);
  const roles = await db.roles.toArray();
  const roleId = (name: string) => roles.find((r) => r.name === name)!.id;

  // Admin user (demo credential)
  const salt = "restaurantos-v1";
  await db.users.add({
    name: "Talha", email: "talhamalikawan@example.com",
    salt, passwordHash: await hashPassword("demo1234", salt),
    roleId: roleId("Administrator"), active: true, createdAt: nowIso(),
  });

  const restaurantId = await db.restaurants.add({ name: "Ember & Oak Bistro", createdAt: nowIso() });
  const branchId = await db.branches.add({ name: "Downtown", code: "DT-01", restaurantId, createdAt: nowIso() });

  const tableDefs = [
    { name: "T-01", capacity: 2, posX: 6, posY: 8 }, { name: "T-02", capacity: 2, posX: 50, posY: 8 },
    { name: "T-03", capacity: 4, posX: 82, posY: 12 }, { name: "T-04", capacity: 4, posX: 10, posY: 52 },
    { name: "T-05", capacity: 6, posX: 44, posY: 48 }, { name: "T-06", capacity: 4, posX: 80, posY: 55 },
    { name: "T-07", capacity: 2, posX: 16, posY: 84 }, { name: "T-08", capacity: 8, posX: 60, posY: 84 },
  ];
  for (const t of tableDefs) await db.restaurantTables.add({ ...t, status: "available", note: "", branchId, active: true });

  const catDefs = ["Starters", "Burgers & Mains", "Pizza", "Salads & Bowls", "Desserts", "Beverages"];
  const catIds: Record<string, number> = {};
  for (let i = 0; i < catDefs.length; i++) catIds[catDefs[i]] = await db.categories.add({ name: catDefs[i], sortOrder: i, active: true });

  // Ingredients (name, unit, cost cents, stock, minStock) — ~30% food-cost economics
  const ingDefs: [string, string, number, number, number][] = [
    ["Burger Bun", "pcs", 24, 512, 40], ["Beef Patty", "pcs", 108, 416, 30], ["Cheese Slice", "pcs", 21, 480, 40],
    ["Lettuce", "g", 1, 6400, 500], ["Tomato", "g", 1, 8000, 600], ["Special Sauce", "g", 2, 3200, 300],
    ["Bacon Strip", "pcs", 36, 288, 24], ["BBQ Sauce", "g", 2, 2560, 250],
    ["Pizza Dough Ball", "pcs", 54, 240, 20], ["Mozzarella", "g", 1, 12800, 1000], ["Pepperoni", "g", 3, 4000, 300],
    ["Mushroom", "g", 2, 3840, 300], ["Truffle Oil", "ml", 7, 800, 60], ["Tomato Sauce", "g", 1, 8000, 600], ["Fresh Basil", "g", 1, 1280, 100],
    ["Salmon Fillet", "pcs", 312, 64, 6], ["Asparagus", "g", 2, 3200, 250], ["Lemon", "pcs", 15, 144, 12], ["Butter", "g", 2, 4000, 300],
    ["Ribeye Cut", "pcs", 588, 48, 5], ["Chicken Breast", "pcs", 144, 128, 10], ["Pasta", "g", 1, 9600, 800],
    ["Cream", "ml", 4, 4800, 400], ["Parmesan", "g", 5, 2400, 150], ["Romaine Lettuce", "g", 1, 4000, 300],
    ["Croutons", "g", 2, 1440, 100], ["Caesar Dressing", "ml", 5, 1920, 150], ["Quinoa", "g", 2, 4800, 400],
    ["Avocado", "pcs", 66, 96, 8], ["Chickpeas", "g", 1, 3840, 300],
    ["Mascarpone", "g", 4, 2880, 200], ["Ladyfingers", "pcs", 12, 320, 24], ["Espresso Shot", "ml", 2, 3840, 300],
    ["Flour", "g", 1, 9600, 800], ["Sugar", "g", 1, 8000, 600], ["Dark Chocolate", "g", 3, 2880, 200], ["Egg", "pcs", 11, 384, 30],
    ["Milk", "ml", 1, 9600, 800], ["Coffee Beans", "g", 9, 2400, 200],
    ["Mint Leaves", "g", 1, 800, 60], ["Sparkling Water", "ml", 1, 9600, 1000], ["Cola Syrup", "ml", 2, 2560, 200],
    ["Calamari Rings", "g", 5, 2560, 200], ["Garlic Aioli", "ml", 6, 1440, 120], ["Sourdough Slice", "pcs", 18, 224, 18],
    ["Onion", "g", 1, 4800, 400], ["Olive Oil", "ml", 2, 2400, 200], ["Seasonal Vegetables", "g", 1, 4000, 300],
  ];
  const ingIds: Record<string, number> = {};
  for (const [name, unit, cost, stock, min] of ingDefs) {
    ingIds[name] = await db.ingredients.add({ name, unit, unitCostCents: cost, stockQty: stock, minStock: min, active: true });
    await db.stockMovements.add({
      ingredientId: ingIds[name], type: "adjustment", quantity: stock, unitCostCents: cost,
      referenceType: "manual", referenceId: null, source: "manual", note: "Opening stock (seed)", createdAt: nowIso(),
    });
  }

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
    prodIds[name] = await db.products.add({
      name, categoryId: catIds[cat], priceCents: price, taxRateBp: tax, color, description: desc,
      sku: null, available: true, branchId, createdAt: nowIso(), updatedAt: nowIso(),
    });
  }

  const modDefs: [string, string, number][] = [
    ["Classic Burger", "Extra Cheese", 120], ["Classic Burger", "Add Bacon", 180], ["Classic Burger", "Gluten-free Bun", 90],
    ["Smoked BBQ Burger", "Extra Cheese", 120], ["Smoked BBQ Burger", "Add Bacon", 180],
    ["Margherita Pizza", "Extra Mozzarella", 150], ["Pepperoni Pizza", "Extra Mozzarella", 150],
    ["Truffle Mushroom Pizza", "Extra Mozzarella", 150],
    ["Cappuccino", "Large", 100], ["Fresh Lemonade", "Large", 100], ["Craft Cola", "Large", 100],
  ];
  for (const [prod, name, delta] of modDefs) await db.modifiers.add({ productId: prodIds[prod], name, priceDeltaCents: delta });

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
    const recId = await db.recipes.add({ productId: prodIds[prod], notes: "" });
    await db.recipeIngredients.bulkAdd(lines.map(([ing, qty]) => ({ recipeId: recId, ingredientId: ingIds[ing], quantity: qty })));
  }

  await db.taxes.bulkAdd([
    { name: "Food & Dine-in", rateBp: 850 }, { name: "Beverages (reduced)", rateBp: 425 },
  ]);

  for (const sup of [
    { name: "Prime Foods Distribution", contactName: "Marcus Hale", email: "orders@primefoods.example", phone: "+1-555-0182" },
    { name: "FreshFarm Produce Co.", contactName: "Elena Torres", email: "sales@freshfarm.example", phone: "+1-555-0147" },
    { name: "Metro Beverage Supply", contactName: "Rajesh Iyer", email: "hello@metrobev.example", phone: "+1-555-0119" },
  ]) await db.suppliers.add({ ...sup, active: true });

  const empDefs = [
    { name: "Amara Osei", position: "General Manager", department: "Management", role: "Manager", rate: 2800 },
    { name: "Diego Ramos", position: "Head Chef", department: "Kitchen", role: "Kitchen Staff", rate: 2400 },
    { name: "Sofia Lindqvist", position: "Sous Chef", department: "Kitchen", role: "Kitchen Staff", rate: 2100 },
    { name: "Priya Nair", position: "Cashier", department: "Front of House", role: "Cashier", rate: 1600 },
    { name: "Jonas Weber", position: "Inventory Manager", department: "Operations", role: "Inventory Manager", rate: 1900 },
    { name: "Fatima Sy", position: "Accountant", department: "Finance", role: "Accountant", rate: 2300 },
  ];
  for (const e of empDefs) {
    await db.employees.add({ name: e.name, position: e.position, department: e.department, roleId: roleId(e.role), hourlyRateCents: e.rate, status: "active", isVirtual: true, hiredAt: nowIso() });
  }

  const custDefs = [
    ["Hannah Brooks", "+1-555-0141"], ["Yuki Tanaka", "+1-555-0177"], ["Gabriel Moreau", "+1-555-0158"],
    ["Amelia Clarke", "+1-555-0133"], ["Dmitri Petrov", "+1-555-0195"], ["Chloe Dubois", "+1-555-0121"],
    ["Marcus Reid", "+1-555-0168"], ["Ingrid Johansson", "+1-555-0189"],
  ];
  for (const [name, phone] of custDefs) {
    await db.customers.add({
      name, phone, email: `${name.split(" ")[0].toLowerCase()}@example.com`, segment: "new",
      loyaltyPoints: 0, totalSpentCents: 0, visits: 0, isVirtual: true, createdAt: nowIso(),
    });
  }

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
    await db.expenses.add({ category, description, amountCents: amount, incurredAt: iso(Date.now() - daysAgo * 86400000), createdAt: nowIso() });
  }

  // ~2 weeks of historical orders through the real pipeline
  const customers = await db.customers.toArray();
  const prodList = Object.values(prodIds);
  let created = 0;
  for (let daysAgo = 13; daysAgo >= 1; daysAgo--) {
    const count = rand(9, 14);
    for (let i = 0; i < count; i++) {
      const isDineIn = Math.random() < 0.4;
      const freeTables = await db.restaurantTables.where("status").equals("available").toArray();
      const table = isDineIn && freeTables.length ? pick(freeTables) : null;
      const items = Array.from({ length: rand(1, 3) }, () => ({ productId: pick(prodList), quantity: rand(1, 2) }));
      try {
        const order = await createOrder("system", {
          type: isDineIn && table ? "dine_in" : pick(["takeaway", "delivery"]),
          tableId: table?.id ?? null, customerId: pick(customers).id, items, autoConfirm: true,
        });
        await transitionOrder("system", order.id, "start_prepare");
        await transitionOrder("system", order.id, "ready");
        try {
          await transitionOrder("system", order.id, "complete", { paymentMethod: pick(["cash", "card", "card", "mobile"]) });
          const when = iso(Date.now() - daysAgo * 86400000 + rand(6, 20) * 3600000 + rand(0, 3540) * 1000);
          await db.orders.update(order.id, { createdAt: when, completedAt: when, updatedAt: when });
          const pay = await db.payments.where("orderId").equals(order.id).first();
          if (pay) await db.payments.update(pay.id, { createdAt: when });
          created++;
        } catch {
          await transitionOrder("system", order.id, "cancel");
        }
        await db.restaurantTables.where("status").equals("cleaning").modify({ status: "available" });
      } catch { /* no free tables — try next */ }
    }
  }

  // Low-stock demo with audited adjustment movement
  for (const [name, target] of [["Salmon Fillet", 4], ["Ribeye Cut", 2]] as const) {
    const ing = await db.ingredients.where("name").equals(name).first();
    if (ing && ing.stockQty > target) {
      const diff = Math.round((ing.stockQty - target) * 1000) / 1000;
      await db.ingredients.update(ing.id, { stockQty: target });
      await db.stockMovements.add({
        ingredientId: ing.id, type: "adjustment", quantity: diff, unitCostCents: ing.unitCostCents,
        referenceType: "manual", referenceId: null, source: "manual",
        note: `-${diff} ${ing.unit} — Stocktake write-down (seed)`, createdAt: nowIso(),
      });
    }
  }

  console.info(`[spa] demo ready — ${created} historical completed orders. Login: talhamalikawan@example.com / demo1234`);
  return true;
}
