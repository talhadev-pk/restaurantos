export async function register() {
  // Runs once when the Node.js server starts (dev & production).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureSeeded } = await import("@/db/bootstrap");
  await ensureSeeded();
}
