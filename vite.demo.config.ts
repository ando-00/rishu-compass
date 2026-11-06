import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 公開デモ（GitHub Pages）のビルド。サーバーを置かず、API もブラウザの中で動かす。
export default defineConfig({
  base: "./",
  build: { outDir: "dist-demo", emptyOutDir: true },
  worker: { format: "es" },
  plugins: [
    react(),
    {
      name: "demo-entry",
      transformIndexHtml: { order: "pre", handler: (html) => html.replace("/src/main.tsx", "/demo/main.ts") },
    },
  ],
});
