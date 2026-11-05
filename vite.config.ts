import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// For GitHub Pages project sites: base path = "/<repo-name>/".
// Override with the VITE_BASE environment variable for custom domains ("/").
export default defineConfig({
  base: process.env.VITE_BASE ?? "/restaurantos/",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1600 },
});
