import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // relative paths, so the build works under any GitHub Pages sub-path
  plugins: [react()],
  worker: { format: "es" },
});
