import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // relative paths, so the build works under any GitHub Pages sub-path
  plugins: [react()],
  worker: { format: "es" },
  // Firefox gathers no WebRTC candidates on pages loaded over IPv6 loopback (::1), where Node's "localhost" lands on
  // Windows: serve over IPv4 so multiplayer works in every browser.
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
