import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/web",
  server: {
    proxy: { "/api": "http://127.0.0.1:14345" },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
