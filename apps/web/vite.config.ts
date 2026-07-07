import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["ref-logo.png", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "Управление временным персоналом",
        short_name: "REF Staff",
        description: "Планирование, проживание и фиксация временного персонала",
        theme_color: "#f6c500",
        background_color: "#ffffff",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "150x107", type: "image/png" },
          { src: "/pwa-512.png", sizes: "150x107", type: "image/png" }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"]
      }
    })
  ],
  server: {
    port: 8095,
    allowedHosts: [".trycloudflare.com", ".loca.lt"],
    proxy: {
      "/api": {
        target: "http://localhost:8096",
        changeOrigin: true
      }
    }
  }
});
