import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./", // relative paths, so the build works under any GitHub Pages sub-path
  plugins: [
    react(),
    // Installable, and playable offline (specification §8, Offline and install). "prompt": a new version waits until
    // the player reloads from the menu, so a running game never loses the chunks it still has to load.
    VitePWA({
      registerType: "prompt",
      injectRegister: false, // registered from main.tsx
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Geonomics",
        short_name: "Geonomics",
        description: "Run a realm on a living map: areas produce, trade and set their own prices.",
        theme_color: "#161e2a",
        background_color: "#0e141d",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: "es" },
  // Firefox gathers no WebRTC candidates on pages loaded over IPv6 loopback (::1), where Node's "localhost" lands on
  // Windows: serve over IPv4 so multiplayer works in every browser.
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
