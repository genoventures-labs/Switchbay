import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function localApiToken() {
  try {
    return readFileSync(process.env.SWITCHBAY_API_TOKEN_FILE || join(homedir(), ".switchbay", "api-token"), "utf8").trim();
  } catch {
    return process.env.SWITCHBAY_API_TOKEN?.trim() || "";
  }
}

const apiToken = localApiToken();

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
    proxy: {
      "/switchbay-api": {
        target: "http://127.0.0.1:7349",
        changeOrigin: true,
        headers: apiToken ? { authorization: `Bearer ${apiToken}` } : undefined,
        rewrite: (path) => path.replace(/^\/switchbay-api/, ""),
      },
    },
  },
  plugins: [react()],
});
