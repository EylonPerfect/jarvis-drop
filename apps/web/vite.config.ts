import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Allow importing the workspace `@jarvis/shared` TS source directly.
export default defineConfig({
  plugins: [react()],
  // Read the repo-root .env (shared with the BFF) so VITE_API_BASE is available in dev.
  envDir: resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "@jarvis/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [resolve(__dirname, "../..")] },
  },
});
