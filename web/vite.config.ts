import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL ?? "http://127.0.0.1:3021";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    host: "127.0.0.1",
    proxy: {
      "/api": { target: API, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
  },
});
